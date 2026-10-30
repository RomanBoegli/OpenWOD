import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { builderToWorkout, emptySection, emptySlot, LIST_FORMATS, MANUAL_FORMATS, validateDraft, type BuilderDraft, type BuilderSection, type BuilderSlot } from '../../../packages/domain/src/builder';
import { compileWorkout, type ExecutionPlan } from '../../../packages/domain/src/compiler';
import { rateDifficulty, type DifficultyCalibration } from '../../../packages/domain/src/difficulty';
import { FORMAT_HELP, FORMAT_LABELS, LOAD_LEVELS, SECTION_FORMATS, type LoadLevel, type LoadValue, type Prescription, type SectionFormat, type Workout } from '../../../packages/domain/src/schema';
import type { SaveResult } from './data/use-library-data';
import { workoutHref } from './router';
import { displayTime } from '../../../packages/engine/src';
import type { Catalogue, Movement } from '../../../packages/domain/src/catalogue';
import { equipmentKey, inferEquipment } from '../../../packages/domain/src/library';
import { recordForName, unmatchedMovements } from './catalogue-link';
import { MovementPicker } from './MovementPicker';
import { ConfirmDialog } from './ConfirmDialog';
import { DifficultyChip } from './DifficultyChip';
import { Icon } from './Icon';
import { NamePicker } from './NamePicker';
import { Chip } from './Chip';
import { LEVEL_LABELS, LEVEL_LETTERS } from './LevelChip';
import styles from './Editor.module.css';
import shared from './App.module.css';
import { TimeInput } from './TimeInput';
import transition from './Transition.module.css';

/** A duration as mm:ss (TimeInput); the model only ever receives valid milliseconds. */
function DurationField({ value, onChange, label, min = 0, id, allowEmpty = false, className }: { value: number; onChange: (ms: number) => void; label: string; min?: number; id?: string; allowEmpty?: boolean; className?: string }) {
  return <label className={className ? `${styles.field} ${className}` : styles.field}>{label}<TimeInput id={id} value={value} min={min} allowEmpty={allowEmpty} placeholder={allowEmpty ? 'none' : undefined} onChange={onChange} /></label>;
}

type AfterSection = 'ready' | 'rest' | 'straight' | 'restReady';
const AFTER_LABELS: Record<AfterSection, string> = { ready: 'Wait for Ready', rest: 'Rest, then continue', straight: 'Continue straight away', restReady: 'Rest, then wait for Ready' };

type TargetKind = 'none' | 'reps' | 'calories' | 'm' | 'km' | 'time';
const TARGET_LABELS: Record<TargetKind, string> = { none: 'No target', reps: 'Reps', calories: 'Calories', m: 'Metres', km: 'Kilometres', time: 'Seconds' };
const targetKindOf = (value: Prescription): TargetKind => value.reps ? 'reps' : value.calories ? 'calories' : value.distance ? value.distance.unit : value.timeMs ? 'time' : 'none';
const targetAmountOf = (value: Prescription): number | '' => value.reps ?? value.calories ?? (value.distance ? value.distance.value : value.timeMs ? value.timeMs / 1000 : '');
function withTarget(value: Prescription, kind: TargetKind, amount: number | ''): Prescription {
  const { reps: _r, calories: _c, distance: _d, timeMs: _t, ...rest } = value;
  if (kind === 'none' || amount === '' || !(amount > 0)) return rest;
  if (kind === 'reps') return { ...rest, reps: Math.round(amount) };
  if (kind === 'calories') return { ...rest, calories: Math.round(amount) };
  if (kind === 'time') return { ...rest, timeMs: Math.round(amount * 1000) };
  return { ...rest, distance: { value: amount, unit: kind } };
}

type LoadMode = 'none' | 'kg' | 'lb' | 'percent';
const loadModeOf = (value: Prescription): LoadMode => { const load = value.load; if (!load) return 'none'; const first = 'value' in load ? load : load.medium ?? load.light ?? load.heavy; return first?.unit ?? 'none'; };
const levelledOf = (value: Prescription) => Boolean(value.load && !('value' in value.load));
const loadValueOf = (value: Prescription, level?: LoadLevel): number | '' => { const load = value.load; if (!load) return ''; if ('value' in load) return load.value; const picked = level ? load[level] : load.medium; return picked ? picked.value : ''; };
const womenOf = (value: Prescription, level?: LoadLevel): number | '' => { const load = value.load; if (!load) return ''; const picked = 'value' in load ? load : level ? load[level] : load.medium; return picked?.women ?? ''; };
/** Sets or clears the women's amount on one load value (the single value, or the given level). */
function withWomen(value: Prescription, level: LoadLevel | undefined, amount: number | ''): Prescription {
  const load = value.load;
  if (!load) return value;
  const patch = (item: LoadValue): LoadValue => { const { women: _w, ...rest } = item; return amount === '' ? rest : { ...rest, women: amount }; };
  if ('value' in load) return { ...value, load: patch(load) };
  if (!level || !load[level]) return value;
  return { ...value, load: { ...load, [level]: patch(load[level]!) } };
}
function withLoad(value: Prescription, mode: LoadMode, levelled: boolean, amounts: Partial<Record<LoadLevel, number | ''>> & { single?: number | '' }): Prescription {
  const { load: _l, ...rest } = value;
  if (mode === 'none') return rest;
  const unit = mode;
  if (!levelled) { const amount = amounts.single ?? loadValueOf(value); return amount === '' ? rest : { ...rest, load: { value: amount, unit } }; }
  const levels: Partial<Record<LoadLevel, LoadValue>> = {};
  for (const level of LOAD_LEVELS) { const amount = amounts[level] ?? loadValueOf(value, level); if (amount !== '') levels[level] = { value: amount, unit }; }
  return Object.keys(levels).length ? { ...rest, load: levels } : rest;
}

interface EditorProps {
  mode: 'create' | 'replace';
  initial: BuilderDraft;
  /** Set when the draft came from an imported file; the editor then says so and points at unmatched movements. */
  importedFrom?: string;
  catalogue: Catalogue;
  /** The device's difficulty calibration for the live summary. */
  difficulty: DifficultyCalibration;
  onAddMovement: (record: Movement) => void;
  /** Authors to suggest (master data), and the spelling an author takes after merges. */
  authors: string[];
  authorSpelling: (name: string) => string;
  savedAt?: string;
  onAutosave: (draft: BuilderDraft) => void;
  /** The saved workout's id when replacing, for the conflict dialog's link to the newer version. */
  workoutId?: string;
  onSave: (draft: BuilderDraft, overwriteRevision?: number) => Promise<SaveResult>;
  onDiscard: () => void;
}

const lanesOf = (draft: BuilderDraft) => draft.sections.flatMap(section => section.slots.flatMap(slot => [slot.A, slot.B])).filter((lane): lane is Prescription => Boolean(lane?.name.trim()));
const derivedEquipment = (lanes: Prescription[], catalogue: Catalogue) => [...lanes.flatMap(lane => catalogue.equipmentOf(lane)), ...inferEquipment(lanes.filter(lane => !catalogue.resolve(lane)).map(lane => lane.name))];

export function Editor({ mode, workoutId, initial, importedFrom, catalogue, difficulty: calibration, onAddMovement, authors, authorSpelling, savedAt, onAutosave, onSave, onDiscard }: EditorProps) {
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<{ revision: number; document?: Workout }>();
  const save = async (overwrite?: number) => { setSaving(true); try { const result = await onSave(effective, overwrite); if (typeof result === 'object') setConflict(result.conflict); else setConflict(undefined); } finally { setSaving(false); } };
  // A merged author opens in its kept spelling, so saving the workout stores that one.
  const [draft, setDraft] = useState(() => initial.attribution?.author ? { ...initial, attribution: { ...initial.attribution, author: authorSpelling(initial.attribution.author) } } : initial);
  const [dirty, setDirty] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const first = useRef(true);
  const autosave = useRef(onAutosave);
  autosave.current = onAutosave; // The latest callback without re-arming the debounce on every parent render.
  // Equipment is derived, never typed: the catalogue records of the movements in the lanes, keyword inference for
  // names no record knows, plus whatever the opened workout declared that no movement accounts for (a wall, a
  // running route, a squat rack), which is carried as it was.
  const [extras] = useState(() => initial.equipment.filter(item => item.trim() && !derivedEquipment(lanesOf(initial), catalogue).some(known => equipmentKey(known) === equipmentKey(item)))); // Fixed when the editor opens; the parent hands in a fresh `initial` after every autosave.
  const board = useMemo(() => {
    const lanes = lanesOf(draft);
    const movements = [...new Map(lanes.map(lane => [lane.name.trim().toLowerCase(), lane.name.trim()])).values()];
    const seen = new Map<string, string>();
    for (const item of [...derivedEquipment(lanes, catalogue), ...extras]) if (!seen.has(equipmentKey(item))) seen.set(equipmentKey(item), item.trim());
    return { movements, equipment: [...seen.values()] };
  }, [draft, extras, catalogue]);
  /** The draft as it is compiled, autosaved and saved: the derived equipment replaces whatever the draft carries. */
  const effective = useMemo<BuilderDraft>(() => ({ ...draft, equipment: board.equipment }), [draft, board.equipment]);
  const issues = useMemo(() => validateDraft(effective), [effective]);
  const compiled = useMemo<{ plan?: ExecutionPlan; error?: string }>(() => {
    if (issues.length) return {};
    try { return { plan: compileWorkout(builderToWorkout(effective, { id: 'draft', revision: 1 })) }; } catch (error) { return { error: error instanceof Error ? error.message : 'This workout cannot be compiled.' }; }
  }, [effective, issues]);
  const difficulty = useMemo(() => compiled.plan && rateDifficulty(compiled.plan, calibration), [compiled.plan, calibration]);
  const canSave = issues.length === 0 && Boolean(compiled.plan);
  const unmatched = useMemo(() => unmatchedMovements(draft, catalogue), [draft, catalogue]);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setDirty(true);
    const timer = setTimeout(() => { autosave.current(effective); setDirty(false); }, 500);
    return () => clearTimeout(timer);
  }, [effective]);

  const update = (patch: Partial<BuilderDraft>) => setDraft(value => ({ ...value, ...patch }));
  const updateSection = (index: number, patch: Partial<BuilderSection>) => setDraft(value => ({ ...value, sections: value.sections.map((section, i) => i === index ? { ...section, ...patch } : section) }));
  const updateSlot = (s: number, i: number, patch: Partial<BuilderSlot>) => setDraft(value => ({ ...value, sections: value.sections.map((section, j) => j === s ? { ...section, slots: section.slots.map((slot, k) => k === i ? { ...slot, ...patch } : slot) } : section) }));
  const updateLane = (s: number, i: number, role: 'A' | 'B', change: (value: Prescription) => Prescription) => setDraft(value => ({ ...value, sections: value.sections.map((section, j) => j === s ? { ...section, slots: section.slots.map((slot, k) => k === i ? { ...slot, [role]: change(slot[role] ?? { name: '' }) } : slot) } : section) }));
  const move = <T,>(list: T[], from: number, to: number) => { if (to < 0 || to >= list.length) return list; const copy = [...list]; const [item] = copy.splice(from, 1); copy.splice(to, 0, item); return copy; };
  const setParticipants = (participants: 1 | 2) => setDraft(value => ({ ...value, participants, sections: value.sections.map(section => ({ ...section, alternate: participants === 2 && section.alternate, slots: section.slots.map(slot => participants === 2 ? { ...slot, B: slot.B ?? { name: '' } } : { A: slot.A, durationMs: slot.durationMs }) })) }));
  const setFormat = (s: number, format: SectionFormat) => updateSection(s, { format, ...(LIST_FORMATS.includes(format) ? { rounds: 1, betweenSlotsRestMs: 0, trailingRestMs: 0, slotRepeats: 1 } : {}), ...(format === 'amrap' && !draft.sections[s].capMs ? { capMs: 600_000 } : {}), ...(format !== 'timedCircuit' ? { slotRepeats: 1 } : {}) });
  /** What happens after a section (BLD-14): the Ready gate, a timed rest that then continues, or straight on. */
  const afterOf = (section: BuilderSection): AfterSection => section.transitionAfter === 'manualReady' ? section.blockRestMs > 0 ? 'restReady' : 'ready' : section.blockRestMs > 0 ? 'rest' : 'straight';
  const setAfter = (s: number, after: AfterSection) => updateSection(s, after === 'ready' ? { transitionAfter: 'manualReady', blockRestMs: 0 } : after === 'restReady' ? { transitionAfter: 'manualReady' } : after === 'rest' ? { transitionAfter: 'automatic', blockRestMs: draft.sections[s].blockRestMs || 60_000 } : { transitionAfter: 'automatic', blockRestMs: 0 });
  const issueFor = (path: string) => issues.find(issue => issue.path === path)?.message;
  const pair = draft.participants === 2;
  /** Creates records for names the catalogue does not know and links every lane that uses them. */
  const addToCatalogue = (names: string[]) => {
    const created = names.map(name => { const record = recordForName(name, catalogue, board.equipment); onAddMovement(record); return record; });
    setDraft(value => ({ ...value, sections: value.sections.map(section => ({ ...section, slots: section.slots.map(slot => {
      const link = (item?: Prescription) => { if (!item) return item; const record = created.find(entry => entry.name.toLowerCase() === item.name.trim().toLowerCase()); return record ? { ...item, movement: record.id } : item; };
      return { ...slot, A: link(slot.A)!, ...(slot.B ? { B: link(slot.B) } : {}) };
    }) })) }));
    return created;
  };

  const laneCell = (s: number, i: number, role: 'A' | 'B', slot: BuilderSlot) => {
    const value = slot[role] ?? { name: '' };
    const label = `Block ${s + 1} movement ${i + 1}${pair ? ` athlete ${role}` : ''}`;
    const kind = targetKindOf(value);
    const loadMode = loadModeOf(value);
    const levelled = levelledOf(value);
    return <td key={role} className={styles.laneCell}>
      <MovementPicker value={value} label={label} catalogue={catalogue} invalid={Boolean(issueFor(`sections.${s}.slots.${i}.${role}`))} onChange={change => updateLane(s, i, role, change)} onAdd={name => addToCatalogue([name])[0]} />
      <div className={styles.laneGrid}>
        <div className={styles.group}>
          <span className={styles.caption}>Target</span>
          <div className={styles.pairRow}>
            <select aria-label={`${label} target kind`} value={kind} onChange={event => updateLane(s, i, role, current => withTarget(current, event.target.value as TargetKind, targetAmountOf(current) || (event.target.value === 'none' ? '' : 10)))}>{(Object.keys(TARGET_LABELS) as TargetKind[]).map(item => <option key={item} value={item}>{TARGET_LABELS[item]}</option>)}</select>
            {kind !== 'none' && <input type="number" inputMode="decimal" min={0} step={kind === 'km' ? 0.1 : 1} aria-label={`${label} target amount`} value={targetAmountOf(value)} onChange={event => updateLane(s, i, role, current => withTarget(current, kind, event.target.value === '' ? '' : Number(event.target.value)))} />}
          </div>
        </div>
        <div className={styles.group}>
          <span className={styles.caption}>Load</span>
          <div className={styles.pairRow}>
            <select aria-label={`${label} load unit`} value={loadMode} onChange={event => updateLane(s, i, role, current => withLoad(current, event.target.value as LoadMode, levelled, { single: loadValueOf(current) === '' ? 20 : loadValueOf(current) }))}><option value="none">No load</option><option value="kg">kg</option><option value="lb">lb</option><option value="percent">% of 1RM</option></select>
            {loadMode !== 'none' && <label className={styles.inlineCheck}><input type="checkbox" checked={levelled} onChange={event => updateLane(s, i, role, current => withLoad(current, loadMode, event.target.checked, event.target.checked ? { light: Math.round(Number(loadValueOf(current) || 20) * .65), medium: Number(loadValueOf(current) || 20), heavy: Math.round(Number(loadValueOf(current) || 20) * 1.4) } : { single: loadValueOf(current, 'medium') }))} />Levels</label>}
          </div>
        </div>
        {loadMode !== 'none' && <div className={styles.loadTable} data-single={!levelled || undefined} role="group" aria-label={`${label} loads`}>
          <span />
          {levelled ? LOAD_LEVELS.map(level => <span key={level} className={styles.levelHead} data-level={level}><span>{LEVEL_LETTERS[level]}</span>{LEVEL_LABELS[level]}</span>) : <span className={styles.levelHead}>{loadMode === 'percent' ? 'Of 1RM' : 'Amount'}</span>}
          <span className={styles.rowLabel}>{loadMode === 'percent' ? 'All' : 'Men'}</span>
          {levelled ? LOAD_LEVELS.map(level => <input key={level} type="number" inputMode="decimal" min={0} step="any" aria-label={`${label} ${level} load`} value={loadValueOf(value, level)} onChange={event => updateLane(s, i, role, current => withLoad(current, loadMode, true, { [level]: event.target.value === '' ? '' : Number(event.target.value) }))} />)
            : <input type="number" inputMode="decimal" min={0} step="any" aria-label={`${label} load`} value={loadValueOf(value)} onChange={event => updateLane(s, i, role, current => withLoad(current, loadMode, false, { single: event.target.value === '' ? '' : Number(event.target.value) }))} />}
          {loadMode !== 'percent' && <>
            <span className={styles.rowLabel}>Women</span>
            {levelled ? LOAD_LEVELS.map(level => <input key={level} type="number" inputMode="decimal" min={0} step="any" aria-label={`${label} ${level} women’s load`} value={womenOf(value, level)} disabled={loadValueOf(value, level) === ''} onChange={event => updateLane(s, i, role, current => withWomen(current, level, event.target.value === '' ? '' : Number(event.target.value)))} />)
              : <input type="number" inputMode="decimal" min={0} step="any" aria-label={`${label} women’s load`} value={womenOf(value)} onChange={event => updateLane(s, i, role, current => withWomen(current, undefined, event.target.value === '' ? '' : Number(event.target.value)))} />}
          </>}
        </div>}
        <div className={`${styles.group} ${styles.full}`}>
          <span className={styles.caption}>Notes</span>
          <input className={styles.notes} aria-label={`${label} notes`} value={value.notes ?? ''} maxLength={500} placeholder="Tempo, scaling, standards" onChange={event => updateLane(s, i, role, current => ({ ...current, notes: event.target.value }))} />
        </div>
      </div>
    </td>;
  };

  return <div className={styles.editor}>
    <div className={shared.workoutHeading}>
      <div>
        <div className={shared.eyebrow}><a href="#/">YOUR LIBRARY</a> <span>/</span> {importedFrom ? 'IMPORTED WORKOUT' : mode === 'replace' ? 'EDIT WORKOUT' : 'NEW WORKOUT'}</div>
        <h1>{draft.title.trim() || (mode === 'replace' ? 'Edit workout' : 'Build a workout')}</h1>
        <p className={shared.description}>{importedFrom ? `Read from ${importedFrom}. Nothing is saved yet: check the movements, then save it to your library.` : 'Blocks of timed or manual movements with targets, in any of the six formats. Type a movement to pick it from your catalogue; the summary on the right updates as you type.'}</p>
      </div>
    </div>

    <div className={styles.layout}>
      <div className={styles.form}>
        <section className={styles.card} aria-label="Workout details">
          <label className={styles.field}>Title<input value={draft.title} maxLength={160} onChange={event => update({ title: event.target.value })} aria-invalid={issueFor('title') ? true : undefined} /></label>
          <label className={styles.field}>Author<NamePicker label="Author" value={draft.attribution?.author ?? ''} options={authors} placeholder="Who wrote or published it" onChange={author => update({ attribution: { ...draft.attribution, author } })} /></label>
          <label className={styles.field}>Description<textarea rows={2} maxLength={2000} value={draft.description} onChange={event => update({ description: event.target.value })} /></label>
          <div className={styles.row}>
            <fieldset className={styles.choice}><legend>Athletes</legend><div className={styles.choiceBox}>{([1, 2] as const).map(count => <label key={count} data-checked={draft.participants === count}><input type="radio" name="participants" checked={draft.participants === count} onChange={() => setParticipants(count)} /><Icon name={count === 2 ? 'users' : 'user'} size={15} />{count === 2 ? 'Pair' : 'Solo'}</label>)}</div></fieldset>
            <DurationField label="Prep countdown" value={draft.prepMs} onChange={prepMs => update({ prepMs })} />
          </div>
          <details className={styles.details}><summary>Source and licence</summary>
            <div className={styles.row}>
              <label className={styles.field}>Source URL<input type="url" value={draft.attribution?.sourceUrl ?? ''} maxLength={500} placeholder="https://" onChange={event => update({ attribution: { ...draft.attribution, sourceUrl: event.target.value } })} /></label>
              <label className={styles.field}>Licence<input value={draft.attribution?.licence ?? ''} maxLength={300} onChange={event => update({ attribution: { ...draft.attribution, licence: event.target.value } })} /></label>
            </div>
            <label className={styles.field}>Notes<input value={draft.attribution?.notes ?? ''} maxLength={1000} onChange={event => update({ attribution: { ...draft.attribution, notes: event.target.value } })} /></label>
          </details>
        </section>

        <ol className={styles.sections} aria-label="Blocks">
          {draft.sections.map((section, s) => {
            const manual = MANUAL_FORMATS.includes(section.format);
            const list = LIST_FORMATS.includes(section.format);
            const standalone = section.format === 'forTime' || section.format === 'strength' || section.format === 'emom';
            const ygig = section.format === 'youGoIGo';
            const roundsWord = section.format === 'strength' ? 'Sets' : 'Rounds';
            const last = s === draft.sections.length - 1;
            const after = afterOf(section);
            return <Fragment key={s}><li className={styles.card}>
              <div className={styles.sectionTop}>
                <span className={shared.eyebrow}>BLOCK {s + 1} OF {draft.sections.length}</span>
                <div className={styles.toolbar}>
                  <button type="button" className={shared.iconButton} aria-label={`Move block ${s + 1} up`} disabled={s === 0} onClick={() => update({ sections: move(draft.sections, s, s - 1) })}><Icon name="previous" size={16} /></button>
                  <button type="button" className={shared.iconButton} aria-label={`Move block ${s + 1} down`} disabled={s === draft.sections.length - 1} onClick={() => update({ sections: move(draft.sections, s, s + 1) })}><Icon name="next" size={16} /></button>
                  <button type="button" className={shared.quietButton} aria-label={`Duplicate block ${s + 1}`} onClick={() => update({ sections: [...draft.sections.slice(0, s + 1), structuredClone(section), ...draft.sections.slice(s + 1)] })}><Icon name="copy" size={15} />Duplicate</button>
                  <button type="button" className={shared.quietButton} aria-label={`Delete block ${s + 1}`} disabled={draft.sections.length === 1} onClick={() => update({ sections: draft.sections.filter((_, i) => i !== s) })}><Icon name="trash" size={15} />Delete</button>
                </div>
              </div>
              <div className={styles.row}>
                <label className={styles.field}>Block title<input value={section.title} maxLength={160} onChange={event => updateSection(s, { title: event.target.value })} aria-invalid={issueFor(`sections.${s}.title`) ? true : undefined} /></label>
                <label className={styles.field}>Format<select value={section.format} aria-label={`Block ${s + 1} format`} onChange={event => setFormat(s, event.target.value as SectionFormat)}>{SECTION_FORMATS.map(format => <option key={format} value={format} disabled={format === 'youGoIGo' && !pair}>{FORMAT_LABELS[format]}</option>)}</select></label>
                {/* The final section has no tile after it: a rest left there by an older workout stays editable here. */}
                {last && section.blockRestMs > 0 && <DurationField label="Rest at the end of the workout" value={section.blockRestMs} onChange={blockRestMs => updateSection(s, { blockRestMs })} />}
              </div>
              <p className={styles.formatHelp}>{FORMAT_HELP[section.format]}</p>
              {(section.format !== 'timedCircuit' && section.format !== 'strength') && <div className={styles.row}>
                {(section.format === 'amrap' || section.format === 'forTime' || ygig) && <DurationField label={section.format === 'forTime' || ygig ? 'Time cap (optional)' : 'Time cap'} value={section.capMs} allowEmpty={section.format !== 'amrap'} onChange={capMs => updateSection(s, { capMs })} />}
                {section.format === 'amrap' && <label className={styles.field}>Counter<select value={section.counter} onChange={event => updateSection(s, { counter: event.target.value as BuilderSection['counter'] })}><option value="roundsAndReps">Rounds and reps</option><option value="rounds">Rounds only</option><option value="none">No counter</option></select></label>}
                {section.format === 'emom' && <><DurationField label="Every" value={section.intervalMs} min={1000} onChange={intervalMs => updateSection(s, { intervalMs })} /><label className={styles.field}>Intervals<input type="number" min={1} max={999} value={section.intervals} onChange={event => updateSection(s, { intervals: Number(event.target.value) })} /></label></>}
                {ygig && <><label className={styles.field}>Team rounds (0 = by cap)<input type="number" min={0} max={999} value={section.teamRounds} onChange={event => updateSection(s, { teamRounds: Number(event.target.value) })} /></label><DurationField label="Fixed turn (optional)" value={section.turnMs} allowEmpty onChange={turnMs => updateSection(s, { turnMs })} /></>}
              </div>}
              {/* Slot level first, then round level. What happens at the section's edges is the tile between sections (BLD-14). */}
              {!list && <div className={styles.row} role="group" aria-label={`Block ${s + 1} movement settings`}>
                {section.format === 'timedCircuit' && <label className={styles.field}>Repeat each movement<input type="number" min={1} max={999} value={section.slotRepeats} onChange={event => updateSection(s, { slotRepeats: Number(event.target.value) })} /></label>}
                {section.format === 'timedCircuit' && section.slotRepeats > 1 && <DurationField label="Rest within repeats" value={section.slotRepeatRestMs} onChange={slotRepeatRestMs => updateSection(s, { slotRepeatRestMs })} />}
                <DurationField label={manual ? 'Rest between movements' : 'Transition between movements'} value={section.betweenSlotsRestMs} onChange={betweenSlotsRestMs => updateSection(s, { betweenSlotsRestMs })} />
                {/* Older workouts can end every round with a transition after the last slot. It is kept and shown only while it is set. */}
              </div>}
              {!list && <div className={styles.row} role="group" aria-label={`Block ${s + 1} ${section.format === 'strength' ? 'set' : 'round'} settings`}>
                <label className={styles.field}>{roundsWord}<input type="number" min={1} max={999} value={section.rounds} aria-label={`Block ${s + 1} ${roundsWord.toLowerCase()}`} onChange={event => updateSection(s, { rounds: Number(event.target.value) })} /></label>
                {section.rounds > 1 && <DurationField label={`Rest between ${roundsWord.toLowerCase()}`} value={section.betweenRoundsRestMs} onChange={betweenRoundsRestMs => updateSection(s, { betweenRoundsRestMs })} />}
                {section.rounds > 1 && pair && <label className={styles.check}><input type="checkbox" checked={section.alternate} onChange={event => updateSection(s, { alternate: event.target.checked })} />Swap A/B tasks each round</label>}
              </div>}
              <table className={styles.slots}>
                <thead><tr><th scope="col">#</th><th scope="col">{ygig ? 'Work unit (both athletes)' : pair ? 'Athlete A' : 'Movement'}</th>{pair && !ygig && <th scope="col">Athlete B</th>}{!manual && <th scope="col">Work</th>}{pair && standalone && <th scope="col">Done by</th>}<th scope="col"><span className={styles.srOnly}>Actions</span></th></tr></thead>
                <tbody>{section.slots.map((slot, i) => <tr key={i}>
                  <td>{String(i + 1).padStart(2, '0')}</td>
                  {laneCell(s, i, 'A', slot)}
                  {pair && !ygig && laneCell(s, i, 'B', slot)}
                  {!manual && <td><DurationField label="" id={`s${s}-slot${i}-duration`} value={slot.durationMs} min={1000} onChange={durationMs => updateSlot(s, i, { durationMs })} /></td>}
                  {pair && standalone && <td><select aria-label={`Block ${s + 1} movement ${i + 1} completion`} value={slot.completion ?? 'team'} onChange={event => updateSlot(s, i, { completion: event.target.value as BuilderSlot['completion'] })}><option value="team">One Done</option><option value="both">Both tap Done</option></select></td>}
                  <td><div className={styles.toolbar}>
                    <button type="button" className={shared.iconButton} aria-label={`Move movement ${i + 1} up`} disabled={i === 0} onClick={() => updateSection(s, { slots: move(section.slots, i, i - 1) })}><Icon name="previous" size={15} /></button>
                    <button type="button" className={shared.iconButton} aria-label={`Move movement ${i + 1} down`} disabled={i === section.slots.length - 1} onClick={() => updateSection(s, { slots: move(section.slots, i, i + 1) })}><Icon name="next" size={15} /></button>
                    <button type="button" className={shared.iconButton} aria-label={`Duplicate movement ${i + 1}`} onClick={() => updateSection(s, { slots: [...section.slots.slice(0, i + 1), structuredClone(slot), ...section.slots.slice(i + 1)] })}><Icon name="copy" size={15} /></button>
                    <button type="button" className={shared.iconButton} aria-label={`Delete movement ${i + 1}`} disabled={section.slots.length === 1} onClick={() => updateSection(s, { slots: section.slots.filter((_, j) => j !== i) })}><Icon name="trash" size={15} /></button>
                  </div></td>
                </tr>)}</tbody>
              </table>
              <button type="button" className={shared.quietButton} onClick={() => updateSection(s, { slots: [...section.slots, emptySlot(draft.participants)] })}><Icon name="arrow" size={15} />Add movement</button>
            </li>{!last && <li className={transition.tile} role="group" aria-label={`Between block ${s + 1} and ${s + 2}`}>
              <label className={styles.field}>Then<select aria-label={`After block ${s + 1}`} value={after} onChange={event => setAfter(s, event.target.value as AfterSection)}>{(Object.keys(AFTER_LABELS) as AfterSection[]).filter(item => item !== 'restReady' || after === 'restReady').map(item => <option key={item} value={item}>{AFTER_LABELS[item]}</option>)}</select></label>
              {(after === 'rest' || after === 'restReady') && <DurationField label="Rest" value={section.blockRestMs} min={1000} onChange={blockRestMs => updateSection(s, { blockRestMs })} />}
            </li>}</Fragment>;
          })}
        </ol>
        <button type="button" className={shared.quietButton} onClick={() => update({ sections: [...draft.sections, emptySection(draft.participants)] })}><Icon name="arrow" size={15} />Add block</button>
      </div>

      <aside className={styles.summary} aria-label="Summary">
        <div className={styles.summaryCard}>
          <span className={shared.eyebrow}>LIVE SUMMARY</span>
          <dl className={styles.facts}>
            <div><dt>{compiled.plan?.durationKind === 'open' ? 'Timed parts' : compiled.plan?.durationKind === 'capped' ? 'Up to' : 'Active'}</dt><dd>{compiled.plan ? displayTime(compiled.plan.durationMs) : '—'}</dd></div>
            <div><dt>With prep</dt><dd>{compiled.plan ? compiled.plan.durationKind === 'open' ? 'Open' : displayTime(compiled.plan.durationMs + draft.prepMs) : '—'}</dd></div>
          </dl>
          {difficulty && <DifficultyChip difficulty={difficulty} detailed />}
          <div className={styles.board}>
            <div><span className={shared.eyebrow}>NEEDS</span><div className={styles.boardChips} role="group" aria-label="Equipment needed">{board.equipment.length ? board.equipment.map(item => <Chip key={item} kind="neutral">{item}</Chip>) : <Chip kind="neutral">{board.movements.length ? 'Bodyweight only' : 'Nothing yet'}</Chip>}</div></div>
            <div><span className={shared.eyebrow}>MOVEMENTS · {board.movements.length}</span><div className={styles.boardChips}>{board.movements.map(item => <Chip key={item} kind="neutral">{item}</Chip>)}</div></div>
          </div>
          {compiled.plan && <ul className={styles.sectionList}>{compiled.plan.sections.map(section => <li key={section.id}><span>{section.title} <small>· {FORMAT_LABELS[section.format]}</small></span><span>{section.durationKind === 'open' ? 'Open' : section.durationKind === 'capped' ? `Cap ${displayTime(section.capMs ?? section.durationMs)}` : displayTime(section.durationMs)}</span></li>)}</ul>}
          {unmatched.length > 0 && <div className={styles.unmatched} role="status" aria-label="Movements not in your catalogue">
            <strong>{unmatched.length === 1 ? '1 movement is' : `${unmatched.length} movements are`} not in your movement catalogue</strong>
            <ul>{unmatched.map(name => <li key={name}><span>{name}</span><button type="button" onClick={() => addToCatalogue([name])}>Add</button></li>)}</ul>
            <small>Add them as they are, or pick the matching movement in the form. You can tidy names later under Settings → Movements.</small>
            {unmatched.length > 1 && <button type="button" className={shared.quietButton} onClick={() => addToCatalogue(unmatched)}><Icon name="plus" size={14} />Add all {unmatched.length}</button>}
          </div>}
          {(issues.length > 0 || compiled.error) && <ul className={styles.issues} role="alert">{issues.map(issue => <li key={issue.path}>{issue.message}</li>)}{compiled.error && <li>{compiled.error}</li>}</ul>}
          <p className={styles.status} aria-live="polite">{dirty ? 'Unsaved changes…' : savedAt ? `Draft saved on this device · ${new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Drafts save automatically on this device.'}</p>
          <div className={styles.saveActions}>
            <button type="button" className={shared.primaryButton} disabled={!canSave || saving} onClick={() => void save()}><Icon name="check" />{saving ? 'Saving…' : mode === 'replace' ? 'Save changes' : 'Save to library'}</button>
            <button type="button" className={shared.quietButton} onClick={() => setDiscarding(true)}>Discard draft</button>
          </div>
        </div>
      </aside>
    </div>

    <ConfirmDialog open={Boolean(conflict)} title="Saved elsewhere since you opened it" confirmLabel="Overwrite with mine" cancelLabel="Keep editing" onClose={() => setConflict(undefined)} onConfirm={() => { const revision = conflict?.revision ?? 0; setConflict(undefined); void save(revision); }}>
      <p>Revision {conflict?.revision}{conflict?.document ? ` (“${conflict.document.title}”)` : ''} of this workout was saved elsewhere while you were editing. Overwrite it with your version, or {workoutId ? <a href={workoutHref(workoutId)} onClick={() => onDiscard()}>open the newer version</a> : 'keep editing'} and copy your changes across.</p>
    </ConfirmDialog>
    <ConfirmDialog open={discarding} title="Discard this draft?" confirmLabel="Discard" cancelLabel="Keep editing" onClose={() => setDiscarding(false)} onConfirm={() => { setDiscarding(false); onDiscard(); }}>
      <p>{mode === 'replace' ? 'The saved workout stays as it was. Your unsaved edits are removed from this device.' : 'The draft is removed from this device.'}</p>
    </ConfirmDialog>
  </div>;
}
