import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { builderToWorkout, emptyGroup, emptyRest, emptySection, emptySlot, isSlot, LIST_FORMATS, MANUAL_FORMATS, mapSlots, slotsOf, TIMED_MOVEMENT_FORMATS, validateDraft, type BuilderDraft, type BuilderGroup, type BuilderItem, type BuilderRest, type BuilderSection, type BuilderSlot } from '../../../packages/domain/src/builder';
import { compileWorkout, type ExecutionPlan } from '../../../packages/domain/src/compiler';
import { rateDifficulty, type DifficultyCalibration } from '../../../packages/domain/src/difficulty';
import { restMs } from '../../../packages/domain/src/outline';
import { FORMAT_HELP, FORMAT_LABELS, LOAD_LEVELS, SECTION_FORMATS, type LoadLevel, type Prescription, type SectionFormat, type Workout } from '../../../packages/domain/src/schema';
import type { SaveResult } from './data/use-library-data';
import { workoutHref } from './router';
import { displayTime } from '../../../packages/engine/src';
import type { Catalogue, Movement } from '../../../packages/domain/src/catalogue';
import { equipmentKey, equipmentName, inferEquipment } from '../../../packages/domain/src/library';
import { recordForName, unmatchedMovements } from './catalogue-link';
import { MovementPicker } from './MovementPicker';
import { ConfirmDialog } from './ConfirmDialog';
import { DifficultyChip } from './DifficultyChip';
import { Icon } from './Icon';
import { NamePicker } from './NamePicker';
import { Chip } from './Chip';
import { spanLabel } from './Library';
import { LEVEL_LABELS, LEVEL_LETTERS } from './LevelChip';
import { LOAD_AMOUNT, TARGET_AMOUNTS, TARGET_LABELS, levelledOf, loadModeOf, loadValueOf, targetAmountOf, targetKindOf, withLoad, withTarget, withWomen, womenOf, type LoadMode, type TargetKind } from './lane';
import { NumberInput } from './NumberInput';
import styles from './Editor.module.css';
import shared from './App.module.css';
import { TimeInput } from './TimeInput';
import transition from './Transition.module.css';

/** A duration as mm:ss (TimeInput); the model only ever receives valid milliseconds. */
function DurationField({ value, onChange, label, min = 0, id, allowEmpty = false }: { value: number; onChange: (ms: number) => void; label: string; min?: number; id?: string; allowEmpty?: boolean }) {
  return <label className={styles.field}>{label}<TimeInput id={id} value={value} min={min} allowEmpty={allowEmpty} placeholder={allowEmpty ? 'none' : undefined} onChange={onChange} /></label>;
}

/** A whole number of rounds, intervals or repeats (NumberInput): an emptied field stays empty while typing, and the model only ever receives a count within the bounds. */
function CountField({ value, onChange, label, min = 1, invalid, 'aria-label': ariaLabel }: { value: number; onChange: (count: number) => void; label: string; min?: number; invalid?: boolean; 'aria-label'?: string }) {
  return <label className={styles.field}>{label}<NumberInput value={value} min={min} max={999} aria-label={ariaLabel} aria-invalid={invalid || undefined} onChange={count => { if (count !== '') onChange(count); }} /></label>;
}

type AfterSection = 'ready' | 'rest' | 'straight' | 'restReady';
const AFTER_LABELS: Record<AfterSection, string> = { ready: 'Wait for Ready', rest: 'Rest, then continue', straight: 'Continue straight away', restReady: 'Rest, then wait for Ready' };

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

/** The named lanes that count: a solo draft keeps athlete B's lanes unused (see setParticipants). */
const lanesOf = (draft: BuilderDraft) => draft.sections.flatMap(section => slotsOf(section.slots).flatMap(slot => draft.participants === 2 ? [slot.A, slot.B] : [slot.A])).filter((lane): lane is Prescription => Boolean(lane?.name.trim()));
/** The list at `path` (group positions, from the block's own list down) changed by `change`. */
const editList = (items: BuilderItem[], path: number[], change: (list: BuilderItem[]) => BuilderItem[]): BuilderItem[] => path.length
  ? items.map((item, i) => i === path[0] && item.kind === 'group' ? { ...item, slots: editList(item.slots, path.slice(1), change) } : item)
  : change(items);
const derivedEquipment = (lanes: Prescription[], catalogue: Catalogue) => [...lanes.flatMap(lane => catalogue.equipmentOf(lane)), ...inferEquipment(lanes.filter(lane => !catalogue.resolve(lane)).map(lane => lane.name))];

export function Editor({ mode, workoutId, initial, importedFrom, catalogue, difficulty: calibration, onAddMovement, authors, authorSpelling, savedAt, onAutosave, onSave, onDiscard }: EditorProps) {
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<{ revision: number; document?: Workout }>();
  const [failed, setFailed] = useState(false);
  /** Set once the draft is saved or discarded: the parent has removed it by then, and an autosave after that would bring it back. */
  const closed = useRef(false);
  const save = async (overwrite?: number) => { setSaving(true); setFailed(false); try { const result = await onSave(effective, overwrite); if (result === 'saved' || result === 'queued') closed.current = true; setFailed(result === 'failed'); setConflict(typeof result === 'object' ? result.conflict : undefined); } finally { setSaving(false); } };
  const discard = () => { closed.current = true; onDiscard(); };
  // A merged author opens in its kept spelling, so saving the workout stores that one.
  const [draft, setDraft] = useState(() => initial.attribution?.author ? { ...initial, attribution: { ...initial.attribution, author: authorSpelling(initial.attribution.author) } } : initial);
  const [dirty, setDirty] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const first = useRef(true);
  const autosave = useRef(onAutosave);
  autosave.current = onAutosave; // The latest callback without re-arming the debounce on every parent render.
  /** The draft the debounce has not handed over yet. */
  const pending = useRef<BuilderDraft | undefined>(undefined);
  const flush = () => { if (pending.current && !closed.current) autosave.current(pending.current); pending.current = undefined; };
  /** The block whose "Rest at the end of the workout" field is shown: once shown it stays, so emptying it to retype does not take it away under the cursor. */
  const endRest = useRef<number | undefined>(undefined);
  /** The women's amount of a load level whose field was emptied to retype it; see setLevel. */
  const parkedWomen = useRef<{ at: string; amount: number } | undefined>(undefined);
  // Equipment is derived, never typed: the catalogue records of the movements in the lanes, keyword inference for
  // names no record knows, plus whatever the opened workout declared that no movement accounts for (a wall, a
  // running route, a squat rack), which is carried along in Title Case.
  const [extras] = useState(() => initial.equipment.filter(item => item.trim() && !derivedEquipment(lanesOf(initial), catalogue).some(known => equipmentKey(known) === equipmentKey(item)))); // Fixed when the editor opens; the parent hands in a fresh `initial` after every autosave.
  const board = useMemo(() => {
    const lanes = lanesOf(draft);
    const movements = [...new Map(lanes.map(lane => [lane.name.trim().toLowerCase(), lane.name.trim()])).values()];
    const seen = new Map<string, string>();
    for (const item of [...derivedEquipment(lanes, catalogue), ...extras]) if (!seen.has(equipmentKey(item))) seen.set(equipmentKey(item), equipmentName(item));
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
    pending.current = effective;
    const timer = setTimeout(() => { flush(); setDirty(false); }, 500);
    return () => clearTimeout(timer);
  }, [effective]);
  // Leaving the editor within the debounce would drop the last edit, so it is handed over on the way out: on leaving the page (a reload, a closed tab) as on leaving the route.
  useEffect(() => { window.addEventListener('pagehide', flush); return () => { window.removeEventListener('pagehide', flush); flush(); }; }, []);

  const update = (patch: Partial<BuilderDraft>) => setDraft(value => ({ ...value, ...patch }));
  const updateSection = (index: number, patch: Partial<BuilderSection>) => setDraft(value => ({ ...value, sections: value.sections.map((section, i) => i === index ? { ...section, ...patch } : section) }));
  /** Changes one list of a block: its own (`path` empty) or a group's, addressed by the group positions. */
  const updateList = (s: number, path: number[], change: (list: BuilderItem[]) => BuilderItem[]) => setDraft(value => ({ ...value, sections: value.sections.map((section, j) => j === s ? { ...section, slots: editList(section.slots, path, change) } : section) }));
  const updateItem = <T extends BuilderItem,>(s: number, path: number[], i: number, change: (item: T) => T) => updateList(s, path, list => list.map((item, k) => k === i ? change(item as T) : item));
  const updateSlot = (s: number, path: number[], i: number, patch: Partial<BuilderSlot>) => updateItem<BuilderSlot>(s, path, i, slot => ({ ...slot, ...patch }));
  const updateLane = (s: number, path: number[], i: number, role: 'A' | 'B', change: (value: Prescription) => Prescription) => updateItem<BuilderSlot>(s, path, i, slot => ({ ...slot, [role]: change(slot[role] ?? { name: '' }) }));
  /**
   * Adds a movement, rest or group at the end of a list. A rest or group in a block whose movements each repeat
   * first turns those movements into groups of one with the same repeats, so the timing stays as it was.
   */
  const addItem = (s: number, path: number[], item: BuilderItem) => setDraft(value => ({ ...value, sections: value.sections.map((section, j) => {
    if (j !== s) return section;
    const spread = !isSlot(item) && section.format === 'timedCircuit' && section.slotRepeats > 1;
    const slots = spread ? section.slots.map((slot): BuilderItem => isSlot(slot) ? { kind: 'group', rounds: section.slotRepeats, betweenRoundsRestMs: section.slotRepeatRestMs, alternate: false, betweenSlotsRestMs: 0, slots: [slot] } : slot) : section.slots;
    return { ...section, ...(spread ? { slotRepeats: 1 } : {}), slots: editList(slots, path, list => [...list, item]) };
  }) }));
  const move = <T,>(list: T[], from: number, to: number) => { if (to < 0 || to >= list.length) return list; const copy = [...list]; const [item] = copy.splice(from, 1); copy.splice(to, 0, item); return copy; };
  /**
   * Solo hides athlete B and deletes nothing: B's lanes, the swaps and the Done rules stay in the draft unused (the
   * builder ignores them for one athlete), so switching back to Pair restores them. A pair gets a B lane wherever one is missing.
   */
  const setParticipants = (participants: 1 | 2) => setDraft(value => ({ ...value, participants, sections: participants === 1 ? value.sections : value.sections.map(section => ({ ...section, slots: mapSlots(section.slots, slot => ({ ...slot, B: slot.B ?? { name: '' } })) })) }));
  const setFormat = (s: number, format: SectionFormat) => updateSection(s, { format, ...(LIST_FORMATS.includes(format) ? { rounds: 1, betweenSlotsRestMs: 0, trailingRestMs: 0, slotRepeats: 1 } : {}), ...(format === 'amrap' && !draft.sections[s].capMs ? { capMs: 600_000 } : {}), ...(format !== 'timedCircuit' ? { slotRepeats: 1 } : {}) });
  /** What happens after a section (BLD-14): the Ready gate, a timed rest that then continues, or straight on. */
  const afterOf = (section: BuilderSection): AfterSection => section.transitionAfter === 'manualReady' ? section.blockRestMs > 0 ? 'restReady' : 'ready' : section.blockRestMs > 0 ? 'rest' : 'straight';
  const setAfter = (s: number, after: AfterSection) => updateSection(s, after === 'ready' ? { transitionAfter: 'manualReady', blockRestMs: 0 } : after === 'restReady' ? { transitionAfter: 'manualReady' } : after === 'rest' ? { transitionAfter: 'automatic', blockRestMs: draft.sections[s].blockRestMs || 60_000 } : { transitionAfter: 'automatic', blockRestMs: 0 });
  const issueFor = (path: string) => issues.find(issue => issue.path === path)?.message;
  const pair = draft.participants === 2;
  /** Creates records for names the catalogue does not know and links every lane that uses them. */
  const addToCatalogue = (names: string[]) => {
    const created = names.map(name => { const record = recordForName(name, catalogue, board.equipment); onAddMovement(record); return record; });
    setDraft(value => ({ ...value, sections: value.sections.map(section => ({ ...section, slots: mapSlots(section.slots, slot => {
      const link = (item?: Prescription) => { if (!item) return item; const record = created.find(entry => entry.name.toLowerCase() === item.name.trim().toLowerCase()); return record ? { ...item, movement: record.id } : item; };
      return { ...slot, A: link(slot.A)!, ...(slot.B ? { B: link(slot.B) } : {}) };
    }) })) }));
    return created;
  };

  /** " group 2" for each group a list sits in, for labels; the issue path of an item. */
  const placeOf = (path: number[]) => path.map(g => ` group ${g + 1}`).join('');
  const pathOf = (s: number, path: number[], i: number) => `sections.${s}${path.map(g => `.slots.${g}`).join('')}.slots.${i}`;

  const laneCell = (s: number, path: number[], i: number, role: 'A' | 'B', slot: BuilderSlot) => {
    const value = slot[role] ?? { name: '' };
    const label = `Block ${s + 1}${placeOf(path)} movement ${i + 1}${pair ? ` athlete ${role}` : ''}`;
    const kind = targetKindOf(value);
    const loadMode = loadModeOf(value);
    const levelled = levelledOf(value);
    /**
     * One level's amount. An emptied field removes its level, and with it the level's women's amount: that amount is
     * parked while the field keeps the focus and comes back with the retyped number.
     */
    const setLevel = (level: LoadLevel, amount: number | '') => {
      const at = `${pathOf(s, path, i)}.${role}.${level}`;
      const before = womenOf(value, level);
      if (amount === '' && before !== '') parkedWomen.current = { at, amount: before };
      const women = amount !== '' && parkedWomen.current?.at === at ? parkedWomen.current.amount : '';
      updateLane(s, path, i, role, current => { const next = withLoad(current, loadMode, true, { [level]: amount }); return women === '' ? next : withWomen(next, level, women); });
    };
    return <td key={role} className={styles.laneCell}>
      <MovementPicker value={value} label={label} catalogue={catalogue} invalid={Boolean(issueFor(`${pathOf(s, path, i)}.${role}`))} onChange={change => updateLane(s, path, i, role, change)} onAdd={name => addToCatalogue([name])[0]} />
      <div className={styles.laneGrid}>
        <div className={styles.group}>
          <span className={styles.caption}>Target</span>
          <div className={styles.pairRow}>
            <select aria-label={`${label} target kind`} value={kind} onChange={event => updateLane(s, path, i, role, current => withTarget(current, event.target.value as TargetKind, targetAmountOf(current) || 10))}>{(Object.keys(TARGET_LABELS) as TargetKind[]).map(item => <option key={item} value={item}>{TARGET_LABELS[item]}</option>)}</select>
            {/* The amount never reports an empty field, so the kind and the field stay while a number is retyped; "No target" is the way to remove one. */}
            {kind !== 'none' && <NumberInput {...TARGET_AMOUNTS[kind]} aria-label={`${label} target amount`} value={targetAmountOf(value)} onChange={amount => { if (amount !== '') updateLane(s, path, i, role, current => withTarget(current, kind, amount)); }} />}
          </div>
        </div>
        <div className={styles.group}>
          <span className={styles.caption}>Load</span>
          <div className={styles.pairRow}>
            <select aria-label={`${label} load unit`} value={loadMode} onChange={event => updateLane(s, path, i, role, current => withLoad(current, event.target.value as LoadMode, levelled, { single: loadValueOf(current) === '' ? 20 : loadValueOf(current) }))}><option value="none">No load</option><option value="kg">kg</option><option value="lb">lb</option><option value="percent">% of 1RM</option></select>
            {loadMode !== 'none' && <label className={styles.inlineCheck}><input type="checkbox" checked={levelled} onChange={event => updateLane(s, path, i, role, current => withLoad(current, loadMode, event.target.checked, event.target.checked ? { light: Math.round(Number(loadValueOf(current) || 20) * .65), medium: Number(loadValueOf(current) || 20), heavy: Math.round(Number(loadValueOf(current) || 20) * 1.4) } : { single: loadValueOf(current, 'medium') }))} />Levels</label>}
          </div>
        </div>
        {loadMode !== 'none' && <div className={styles.loadTable} data-single={!levelled || undefined} role="group" aria-label={`${label} loads`}>
          <span />
          {levelled ? LOAD_LEVELS.map(level => <span key={level} className={styles.levelHead} data-level={level}><span>{LEVEL_LETTERS[level]}</span>{LEVEL_LABELS[level]}</span>) : <span className={styles.levelHead}>{loadMode === 'percent' ? 'Of 1RM' : 'Amount'}</span>}
          <span className={styles.rowLabel}>{loadMode === 'percent' ? 'All' : 'Men'}</span>
          {/* A single amount is never empty ("No load" removes it); a level may be emptied while another level still has an amount. */}
          {levelled ? LOAD_LEVELS.map(level => <NumberInput key={level} {...LOAD_AMOUNT} allowEmpty={LOAD_LEVELS.some(other => other !== level && loadValueOf(value, other) !== '')} aria-label={`${label} ${level} load`} value={loadValueOf(value, level)} onChange={amount => setLevel(level, amount)} onBlur={() => { parkedWomen.current = undefined; }} />)
            : <NumberInput {...LOAD_AMOUNT} aria-label={`${label} load`} value={loadValueOf(value)} onChange={single => { if (single !== '') updateLane(s, path, i, role, current => withLoad(current, loadMode, false, { single })); }} />}
          {loadMode !== 'percent' && <>
            <span className={styles.rowLabel}>Women</span>
            {levelled ? LOAD_LEVELS.map(level => <NumberInput key={level} {...LOAD_AMOUNT} allowEmpty aria-label={`${label} ${level} women’s load`} value={womenOf(value, level)} disabled={loadValueOf(value, level) === ''} onChange={amount => updateLane(s, path, i, role, current => withWomen(current, level, amount))} />)
              : <NumberInput {...LOAD_AMOUNT} allowEmpty aria-label={`${label} women’s load`} value={womenOf(value)} onChange={amount => updateLane(s, path, i, role, current => withWomen(current, undefined, amount))} />}
          </>}
        </div>}
        <div className={`${styles.group} ${styles.full}`}>
          <span className={styles.caption}>Notes</span>
          <input className={styles.notes} aria-label={`${label} notes`} value={value.notes ?? ''} maxLength={500} onChange={event => updateLane(s, path, i, role, current => ({ ...current, notes: event.target.value }))} />
        </div>
      </div>
    </td>;
  };

  /**
   * One list, the block's own or a group's, with the buttons that add to it. A rest is a row of its own length, and a
   * group renders its own settings and list inside its row.
   */
  const listTable = (s: number, section: BuilderSection, path: number[], items: BuilderItem[]): ReactNode => {
    const manual = MANUAL_FORMATS.includes(section.format);
    const list = LIST_FORMATS.includes(section.format);
    const ygig = section.format === 'youGoIGo';
    const choice = TIMED_MOVEMENT_FORMATS.includes(section.format);
    const work = !manual || choice;
    const doneBy = pair && (section.format === 'forTime' || section.format === 'strength' || section.format === 'emom');
    const span = 1 + (pair && !ygig ? 1 : 0) + (work ? 1 : 0) + (doneBy ? 1 : 0);
    const place = placeOf(path);
    const roundsWord = section.format === 'strength' ? 'sets' : 'rounds';
    const tools = (noun: string, item: BuilderItem, i: number) => <td><div className={styles.toolbar}>
      <button type="button" className={shared.iconButton} aria-label={`Move${place} ${noun} ${i + 1} up`} disabled={i === 0} onClick={() => updateList(s, path, current => move(current, i, i - 1))}><Icon name="previous" size={15} /></button>
      <button type="button" className={shared.iconButton} aria-label={`Move${place} ${noun} ${i + 1} down`} disabled={i === items.length - 1} onClick={() => updateList(s, path, current => move(current, i, i + 1))}><Icon name="next" size={15} /></button>
      <button type="button" className={shared.iconButton} aria-label={`Duplicate${place} ${noun} ${i + 1}`} onClick={() => updateList(s, path, current => [...current.slice(0, i + 1), structuredClone(item), ...current.slice(i + 1)])}><Icon name="copy" size={15} /></button>
      <button type="button" className={shared.iconButton} aria-label={`Delete${place} ${noun} ${i + 1}`} disabled={items.length === 1} onClick={() => updateList(s, path, current => current.filter((_, j) => j !== i))}><Icon name="trash" size={15} /></button>
    </div></td>;
    const rows = items.map((item, i) => {
      const number = <td>{String(i + 1).padStart(2, '0')}</td>;
      const label = `Block ${s + 1}${place}`;
      if (item.kind === 'rest') return <tr key={i} className={styles.restRow}>{number}
        <td colSpan={span}><label className={styles.restLine}><Icon name="pause" size={15} />Rest<TimeInput aria-label={`${label} rest ${i + 1}`} value={item.durationMs} min={1000} aria-invalid={issueFor(`${pathOf(s, path, i)}.durationMs`) ? true : undefined} onChange={durationMs => updateItem<BuilderRest>(s, path, i, rest => ({ ...rest, durationMs }))} /></label></td>
        {tools('rest', item, i)}
      </tr>;
      if (item.kind === 'group') {
        const group = (patch: Partial<BuilderGroup>) => updateItem<BuilderGroup>(s, path, i, current => ({ ...current, ...patch }));
        return <tr key={i}>{number}
          <td colSpan={span}><div className={styles.nested} role="group" aria-label={`${label} group ${i + 1}`}>
            <span className={styles.caption}>Group</span>
            <div className={styles.row}>
              <CountField label={roundsWord === 'sets' ? 'Sets' : 'Rounds'} value={item.rounds} aria-label={`${label} group ${i + 1} ${roundsWord}`} invalid={Boolean(issueFor(`${pathOf(s, path, i)}.rounds`))} onChange={rounds => group({ rounds })} />
              {item.rounds > 1 && <DurationField label={`Rest between ${roundsWord}`} value={item.betweenRoundsRestMs} onChange={betweenRoundsRestMs => group({ betweenRoundsRestMs })} />}
              <DurationField label={manual ? 'Rest between movements' : 'Transition between movements'} value={item.betweenSlotsRestMs} onChange={betweenSlotsRestMs => group({ betweenSlotsRestMs })} />
              {item.rounds > 1 && pair && <label className={styles.check}><input type="checkbox" checked={item.alternate} onChange={event => group({ alternate: event.target.checked })} />Swap A/B tasks each round</label>}
            </div>
            {listTable(s, section, [...path, i], item.slots)}
          </div></td>
          {tools('group', item, i)}
        </tr>;
      }
      return <tr key={i}>{number}
        {laneCell(s, path, i, 'A', item)}
        {pair && !ygig && laneCell(s, path, i, 'B', item)}
        {work && <td>
          {choice && <select aria-label={`${label} movement ${i + 1} work`} value={item.timed ? 'timed' : 'done'} onChange={event => updateSlot(s, path, i, event.target.value === 'timed' ? { timed: true, durationMs: item.durationMs >= 1000 ? item.durationMs : 30_000 } : { timed: undefined })}><option value="done">Until Done</option><option value="timed">Timed</option></select>}
          {(!manual || item.timed) && <DurationField label="" id={`s${s}-${path.map(g => `${g}-`).join('')}slot${i}-duration`} value={item.durationMs} min={1000} onChange={durationMs => updateSlot(s, path, i, { durationMs })} />}
        </td>}
        {doneBy && <td>{!item.timed && <select aria-label={`${label} movement ${i + 1} completion`} value={item.completion ?? 'team'} onChange={event => updateSlot(s, path, i, { completion: event.target.value as BuilderSlot['completion'] })}><option value="team">One Done</option><option value="both">Both tap Done</option></select>}</td>}
        {tools('movement', item, i)}
      </tr>;
    });
    return <>
      <table className={styles.slots}>
        <thead><tr><th scope="col">#</th><th scope="col">{ygig ? 'Work unit (both athletes)' : pair ? 'Athlete A' : 'Movement'}</th>{pair && !ygig && <th scope="col">Athlete B</th>}{work && <th scope="col">Work</th>}{doneBy && <th scope="col">Done by</th>}<th scope="col"><span className={styles.srOnly}>Actions</span></th></tr></thead>
        <tbody>{rows}</tbody>
      </table>
      <div className={styles.addRow}>
        <button type="button" className={shared.quietButton} aria-label={path.length ? `Add movement to${place}` : undefined} onClick={() => addItem(s, path, emptySlot(draft.participants))}><Icon name="arrow" size={15} />Add movement</button>
        {!list && <button type="button" className={shared.quietButton} aria-label={path.length ? `Add rest to${place}` : undefined} onClick={() => addItem(s, path, emptyRest())}><Icon name="pause" size={15} />Add rest</button>}
        {/* Groups are added to the block's own list: block rounds and group rounds are the two levels a workout may nest. */}
        {!list && !path.length && <button type="button" className={shared.quietButton} onClick={() => addItem(s, path, emptyGroup(draft.participants, section.format))}><Icon name="list" size={15} />Add group</button>}
      </div>
    </>;
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
          <label className={styles.field}>Author<NamePicker label="Author" value={draft.attribution?.author ?? ''} options={authors} onChange={author => update({ attribution: { ...draft.attribution, author } })} /></label>
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
            const ygig = section.format === 'youGoIGo';
            const roundsWord = section.format === 'strength' ? 'Sets' : 'Rounds';
            const last = s === draft.sections.length - 1;
            const after = afterOf(section);
            if (last && section.blockRestMs > 0) endRest.current = s;
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
                {last && (section.blockRestMs > 0 || endRest.current === s) && <DurationField label="Rest at the end of the workout" value={section.blockRestMs} min={1000} allowEmpty onChange={blockRestMs => updateSection(s, { blockRestMs })} />}
              </div>
              <p className={styles.formatHelp}>{FORMAT_HELP[section.format]}</p>
              {(section.format !== 'timedCircuit' && section.format !== 'strength') && <div className={styles.row}>
                {(section.format === 'amrap' || section.format === 'forTime' || ygig) && <DurationField label={section.format === 'forTime' || ygig ? 'Time cap (optional)' : 'Time cap'} value={section.capMs} allowEmpty={section.format !== 'amrap'} onChange={capMs => updateSection(s, { capMs })} />}
                {section.format === 'amrap' && <label className={styles.field}>Counter<select value={section.counter} onChange={event => updateSection(s, { counter: event.target.value as BuilderSection['counter'] })}><option value="roundsAndReps">Rounds and reps</option><option value="rounds">Rounds only</option><option value="none">No counter</option></select></label>}
                {section.format === 'emom' && <><DurationField label="Every" value={section.intervalMs} min={1000} onChange={intervalMs => updateSection(s, { intervalMs })} /><CountField label="Intervals" value={section.intervals} onChange={intervals => updateSection(s, { intervals })} /></>}
                {ygig && <><CountField label="Team rounds (0 = by cap)" min={0} value={section.teamRounds} onChange={teamRounds => updateSection(s, { teamRounds })} /><DurationField label="Fixed turn (optional)" value={section.turnMs} allowEmpty onChange={turnMs => updateSection(s, { turnMs })} /></>}
              </div>}
              {/* Slot level first, then round level. What happens at the section's edges is the tile between sections (BLD-14). */}
              {!list && <div className={styles.row} role="group" aria-label={`Block ${s + 1} movement settings`}>
                {/* Per-movement repeats apply to the block's own movements, so the field shows while those are all it lists. */}
                {section.format === 'timedCircuit' && (section.slotRepeats > 1 || section.slots.every(isSlot)) && <CountField label="Repeat each movement" value={section.slotRepeats} onChange={slotRepeats => updateSection(s, { slotRepeats })} />}
                {section.format === 'timedCircuit' && section.slotRepeats > 1 && <DurationField label="Rest within repeats" value={section.slotRepeatRestMs} onChange={slotRepeatRestMs => updateSection(s, { slotRepeatRestMs })} />}
                <DurationField label={manual ? 'Rest between movements' : 'Transition between movements'} value={section.betweenSlotsRestMs} onChange={betweenSlotsRestMs => updateSection(s, { betweenSlotsRestMs })} />
              </div>}
              {!list && <div className={styles.row} role="group" aria-label={`Block ${s + 1} ${section.format === 'strength' ? 'set' : 'round'} settings`}>
                <CountField label={roundsWord} value={section.rounds} aria-label={`Block ${s + 1} ${roundsWord.toLowerCase()}`} onChange={rounds => updateSection(s, { rounds })} />
                {section.rounds > 1 && <DurationField label={`Rest between ${roundsWord.toLowerCase()}`} value={section.betweenRoundsRestMs} onChange={betweenRoundsRestMs => updateSection(s, { betweenRoundsRestMs })} />}
                {section.rounds > 1 && pair && <label className={styles.check}><input type="checkbox" checked={section.alternate} onChange={event => updateSection(s, { alternate: event.target.checked })} />Swap A/B tasks each round</label>}
              </div>}
              {listTable(s, section, [], section.slots)}
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
            {/* The same three times as the workout's page: total is active plus rest, without the prep countdown. */}
            <div><dt>Total time</dt><dd>{compiled.plan ? spanLabel(compiled.plan.durationKind, compiled.plan.durationMs) : '—'}</dd></div>
            <div><dt>Active time</dt><dd>{compiled.plan ? spanLabel(compiled.plan.durationKind, compiled.plan.durationMs - restMs(compiled.plan)) : '—'}</dd></div>
            <div><dt>Rest time</dt><dd>{compiled.plan ? displayTime(restMs(compiled.plan)) : '—'}</dd></div>
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
          {(issues.length > 0 || compiled.error || failed) && <ul className={styles.issues} role="alert">{failed && <li>The workout was not saved. Your edits are still here: try again.</li>}{issues.map(issue => <li key={issue.path}>{issue.message}</li>)}{compiled.error && <li>{compiled.error}</li>}</ul>}
          <p className={styles.status} aria-live="polite">{dirty ? 'Unsaved changes…' : savedAt ? `Draft saved on this device · ${new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Drafts save automatically on this device.'}</p>
          <div className={styles.saveActions}>
            <button type="button" className={shared.primaryButton} disabled={!canSave || saving} onClick={() => void save()}><Icon name="check" />{saving ? 'Saving…' : mode === 'replace' ? 'Save changes' : 'Save to library'}</button>
            <button type="button" className={shared.quietButton} onClick={() => setDiscarding(true)}>Discard draft</button>
          </div>
        </div>
      </aside>
    </div>

    <ConfirmDialog open={Boolean(conflict)} title="Saved elsewhere since you opened it" confirmLabel="Overwrite with mine" cancelLabel="Keep editing" onClose={() => setConflict(undefined)} onConfirm={() => { const revision = conflict?.revision ?? 0; setConflict(undefined); void save(revision); }}>
      <p>Revision {conflict?.revision}{conflict?.document ? ` (“${conflict.document.title}”)` : ''} of this workout was saved elsewhere while you were editing. Overwrite it with your version, or {workoutId ? <a href={workoutHref(workoutId)} onClick={discard}>open the newer version</a> : 'keep editing'} and copy your changes across.</p>
    </ConfirmDialog>
    <ConfirmDialog open={discarding} title="Discard this draft?" confirmLabel="Discard" cancelLabel="Keep editing" onClose={() => setDiscarding(false)} onConfirm={() => { setDiscarding(false); discard(); }}>
      <p>{mode === 'replace' ? 'The saved workout stays as it was. Your unsaved edits are removed from this device.' : 'The draft is removed from this device.'}</p>
    </ConfirmDialog>
  </div>;
}
