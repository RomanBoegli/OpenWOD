import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDuration, parseDuration } from '../../../packages/domain/src';
import { builderToWorkout, emptySection, emptySlot, validateDraft, type BuilderDraft, type BuilderSection, type BuilderSlot } from '../../../packages/domain/src/builder';
import { compileWorkout, type ExecutionPlan } from '../../../packages/domain/src/compiler';
import { rateDifficulty } from '../../../packages/domain/src/difficulty';
import { displayTime } from '../../../packages/engine/src';
import { ConfirmDialog } from './ConfirmDialog';
import { DifficultyChip } from './DifficultyChip';
import { Icon } from './Icon';
import styles from './Editor.module.css';
import shared from './App.module.css';

const toText = (ms: number) => ms % 1000 === 0 ? displayTime(ms, 'floor') : formatDuration(ms);

/** A duration entered as m:ss, 40s, 1m30s or seconds; the model only ever receives valid milliseconds. */
function DurationField({ value, onChange, label, min = 0, id }: { value: number; onChange: (ms: number) => void; label: string; min?: number; id?: string }) {
  const [text, setText] = useState(() => toText(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setText(current => { try { return parseDuration(current) === value ? current : toText(value); } catch { return toText(value); } }); }, [value]);
  return <label className={styles.field}>{label}<input id={id} inputMode="numeric" value={text} aria-invalid={invalid || undefined} onChange={event => {
    setText(event.target.value);
    try { const ms = parseDuration(event.target.value); if (ms < min) throw new Error('short'); setInvalid(false); onChange(ms); } catch { setInvalid(true); }
  }} /></label>;
}

interface EditorProps {
  mode: 'create' | 'replace';
  initial: BuilderDraft;
  savedAt?: string;
  onAutosave: (draft: BuilderDraft) => void;
  onSave: (draft: BuilderDraft) => void;
  onDiscard: () => void;
}

export function Editor({ mode, initial, savedAt, onAutosave, onSave, onDiscard }: EditorProps) {
  const [draft, setDraft] = useState(initial);
  const [equipmentText, setEquipmentText] = useState(initial.equipment.join(', '));
  const [dirty, setDirty] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const first = useRef(true);
  const autosave = useRef(onAutosave);
  autosave.current = onAutosave; // The latest callback without re-arming the debounce on every parent render.
  const issues = useMemo(() => validateDraft(draft), [draft]);
  const compiled = useMemo<{ plan?: ExecutionPlan; error?: string }>(() => {
    if (issues.length) return {};
    try { return { plan: compileWorkout(builderToWorkout(draft, { id: 'draft', revision: 1 })) }; } catch (error) { return { error: error instanceof Error ? error.message : 'This workout cannot be compiled.' }; }
  }, [draft, issues]);
  const difficulty = useMemo(() => compiled.plan && rateDifficulty(compiled.plan), [compiled.plan]);
  const canSave = issues.length === 0 && Boolean(compiled.plan);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setDirty(true);
    const timer = setTimeout(() => { autosave.current(draft); setDirty(false); }, 500);
    return () => clearTimeout(timer);
  }, [draft]);

  const update = (patch: Partial<BuilderDraft>) => setDraft(value => ({ ...value, ...patch }));
  const updateSection = (index: number, patch: Partial<BuilderSection>) => setDraft(value => ({ ...value, sections: value.sections.map((section, i) => i === index ? { ...section, ...patch } : section) }));
  const updateSlot = (s: number, i: number, patch: Partial<BuilderSlot>) => updateSection(s, { slots: draft.sections[s].slots.map((slot, j) => j === i ? { ...slot, ...patch } : slot) });
  const move = <T,>(list: T[], from: number, to: number) => { if (to < 0 || to >= list.length) return list; const copy = [...list]; const [item] = copy.splice(from, 1); copy.splice(to, 0, item); return copy; };
  const setParticipants = (participants: 1 | 2) => setDraft(value => ({ ...value, participants, sections: value.sections.map(section => ({ ...section, alternate: participants === 2 && section.alternate, slots: section.slots.map(slot => participants === 2 ? { ...slot, B: slot.B ?? { name: '' } } : { A: slot.A, durationMs: slot.durationMs }) })) }));
  const issueFor = (path: string) => issues.find(issue => issue.path === path)?.message;
  const pair = draft.participants === 2;

  return <div className={styles.editor}>
    <div className={shared.workoutHeading}>
      <div>
        <div className={shared.eyebrow}><a href="#/">YOUR LIBRARY</a> <span>/</span> {mode === 'replace' ? 'EDIT WORKOUT' : 'NEW WORKOUT'}</div>
        <h1>{draft.title.trim() || (mode === 'replace' ? 'Edit workout' : 'Build a workout')}</h1>
        <p className={shared.description}>Timed circuits: sections of work slots with explicit rests, optional rounds, and a ready gate between sections. The summary on the right updates as you type.</p>
      </div>
    </div>

    <div className={styles.layout}>
      <div className={styles.form}>
        <section className={styles.card} aria-label="Workout details">
          <label className={styles.field}>Title<input value={draft.title} maxLength={160} onChange={event => update({ title: event.target.value })} aria-invalid={issueFor('title') ? true : undefined} /></label>
          <label className={styles.field}>Description<textarea rows={2} maxLength={2000} value={draft.description} onChange={event => update({ description: event.target.value })} /></label>
          <div className={styles.row}>
            <fieldset className={styles.choice}><legend>Athletes</legend>{([1, 2] as const).map(count => <label key={count} data-checked={draft.participants === count}><input type="radio" name="participants" checked={draft.participants === count} onChange={() => setParticipants(count)} /><Icon name={count === 2 ? 'users' : 'user'} size={15} />{count === 2 ? 'Pair' : 'Solo'}</label>)}</fieldset>
            <DurationField label="Prep countdown" value={draft.prepMs} onChange={prepMs => update({ prepMs })} />
            <label className={styles.field}>Equipment<input value={equipmentText} placeholder="Dumbbells, Kettlebell" onChange={event => { setEquipmentText(event.target.value); update({ equipment: event.target.value.split(',').map(item => item.trim()).filter(Boolean) }); }} /></label>
          </div>
          <details className={styles.details}><summary>Source and attribution</summary>
            <div className={styles.row}>
              <label className={styles.field}>Author<input value={draft.attribution?.author ?? ''} maxLength={160} onChange={event => update({ attribution: { ...draft.attribution, author: event.target.value } })} /></label>
              <label className={styles.field}>Source URL<input type="url" value={draft.attribution?.sourceUrl ?? ''} maxLength={500} placeholder="https://" onChange={event => update({ attribution: { ...draft.attribution, sourceUrl: event.target.value } })} /></label>
              <label className={styles.field}>Licence<input value={draft.attribution?.licence ?? ''} maxLength={300} onChange={event => update({ attribution: { ...draft.attribution, licence: event.target.value } })} /></label>
            </div>
            <label className={styles.field}>Notes<input value={draft.attribution?.notes ?? ''} maxLength={1000} onChange={event => update({ attribution: { ...draft.attribution, notes: event.target.value } })} /></label>
          </details>
        </section>

        <ol className={styles.sections} aria-label="Sections">
          {draft.sections.map((section, s) => <li key={s} className={styles.card}>
            <div className={styles.sectionTop}>
              <span className={shared.eyebrow}>SECTION {s + 1} OF {draft.sections.length}</span>
              <div className={styles.toolbar}>
                <button type="button" className={shared.iconButton} aria-label={`Move section ${s + 1} up`} disabled={s === 0} onClick={() => update({ sections: move(draft.sections, s, s - 1) })}><Icon name="previous" size={16} /></button>
                <button type="button" className={shared.iconButton} aria-label={`Move section ${s + 1} down`} disabled={s === draft.sections.length - 1} onClick={() => update({ sections: move(draft.sections, s, s + 1) })}><Icon name="next" size={16} /></button>
                <button type="button" className={shared.quietButton} aria-label={`Duplicate section ${s + 1}`} onClick={() => update({ sections: [...draft.sections.slice(0, s + 1), structuredClone(section), ...draft.sections.slice(s + 1)] })}>Duplicate</button>
                <button type="button" className={shared.quietButton} aria-label={`Delete section ${s + 1}`} disabled={draft.sections.length === 1} onClick={() => update({ sections: draft.sections.filter((_, i) => i !== s) })}><Icon name="trash" size={15} />Delete</button>
              </div>
            </div>
            <div className={styles.row}>
              <label className={styles.field}>Section title<input value={section.title} maxLength={160} onChange={event => updateSection(s, { title: event.target.value })} aria-invalid={issueFor(`sections.${s}.title`) ? true : undefined} /></label>
              <label className={styles.field}>Rounds<input type="number" min={1} max={999} value={section.rounds} onChange={event => updateSection(s, { rounds: Number(event.target.value) })} /></label>
              {section.rounds > 1 && <DurationField label="Rest between rounds" value={section.betweenRoundsRestMs} onChange={betweenRoundsRestMs => updateSection(s, { betweenRoundsRestMs })} />}
              {section.rounds > 1 && pair && <label className={styles.check}><input type="checkbox" checked={section.alternate} onChange={event => updateSection(s, { alternate: event.target.checked })} />Swap A/B tasks each round</label>}
            </div>
            <div className={styles.row}>
              <DurationField label="Transition between slots" value={section.betweenSlotsRestMs} onChange={betweenSlotsRestMs => updateSection(s, { betweenSlotsRestMs })} />
              <DurationField label="Transition after last slot" value={section.trailingRestMs} onChange={trailingRestMs => updateSection(s, { trailingRestMs })} />
              <DurationField label="Rest after section" value={section.blockRestMs} onChange={blockRestMs => updateSection(s, { blockRestMs })} />
              <label className={styles.field}>Then<select value={section.transitionAfter} onChange={event => updateSection(s, { transitionAfter: event.target.value as BuilderSection['transitionAfter'] })}><option value="manualReady">Wait for Ready</option><option value="automatic">Continue automatically</option></select></label>
            </div>
            <table className={styles.slots}>
              <thead><tr><th scope="col">#</th><th scope="col">{pair ? 'Athlete A' : 'Movement'}</th>{pair && <th scope="col">Athlete B</th>}<th scope="col">Work</th><th scope="col"><span className={styles.srOnly}>Actions</span></th></tr></thead>
              <tbody>{section.slots.map((slot, i) => <tr key={i}>
                <td>{String(i + 1).padStart(2, '0')}</td>
                <td><input aria-label={`Section ${s + 1} slot ${i + 1} ${pair ? 'athlete A' : 'movement'}`} value={slot.A.name} maxLength={160} placeholder="Movement" aria-invalid={issueFor(`sections.${s}.slots.${i}.A`) ? true : undefined} onChange={event => updateSlot(s, i, { A: { ...slot.A, name: event.target.value } })} /><input className={styles.notes} aria-label={`Section ${s + 1} slot ${i + 1} ${pair ? 'athlete A ' : ''}notes`} value={slot.A.notes ?? ''} maxLength={500} placeholder="Target or notes" onChange={event => updateSlot(s, i, { A: { ...slot.A, notes: event.target.value } })} /></td>
                {pair && <td><input aria-label={`Section ${s + 1} slot ${i + 1} athlete B`} value={slot.B?.name ?? ''} maxLength={160} placeholder="Movement" aria-invalid={issueFor(`sections.${s}.slots.${i}.B`) ? true : undefined} onChange={event => updateSlot(s, i, { B: { ...slot.B, name: event.target.value } })} /><input className={styles.notes} aria-label={`Section ${s + 1} slot ${i + 1} athlete B notes`} value={slot.B?.notes ?? ''} maxLength={500} placeholder="Target or notes" onChange={event => updateSlot(s, i, { B: { name: slot.B?.name ?? '', ...slot.B, notes: event.target.value } })} /></td>}
                <td><DurationField label="" id={`s${s}-slot${i}-duration`} value={slot.durationMs} min={1000} onChange={durationMs => updateSlot(s, i, { durationMs })} /></td>
                <td><div className={styles.toolbar}>
                  <button type="button" className={shared.iconButton} aria-label={`Move slot ${i + 1} up`} disabled={i === 0} onClick={() => updateSection(s, { slots: move(section.slots, i, i - 1) })}><Icon name="previous" size={15} /></button>
                  <button type="button" className={shared.iconButton} aria-label={`Move slot ${i + 1} down`} disabled={i === section.slots.length - 1} onClick={() => updateSection(s, { slots: move(section.slots, i, i + 1) })}><Icon name="next" size={15} /></button>
                  <button type="button" className={shared.iconButton} aria-label={`Duplicate slot ${i + 1}`} onClick={() => updateSection(s, { slots: [...section.slots.slice(0, i + 1), structuredClone(slot), ...section.slots.slice(i + 1)] })}><Icon name="grid" size={15} /></button>
                  <button type="button" className={shared.iconButton} aria-label={`Delete slot ${i + 1}`} disabled={section.slots.length === 1} onClick={() => updateSection(s, { slots: section.slots.filter((_, j) => j !== i) })}><Icon name="trash" size={15} /></button>
                </div></td>
              </tr>)}</tbody>
            </table>
            <button type="button" className={shared.quietButton} onClick={() => updateSection(s, { slots: [...section.slots, emptySlot(draft.participants)] })}><Icon name="arrow" size={15} />Add slot</button>
          </li>)}
        </ol>
        <button type="button" className={shared.quietButton} onClick={() => update({ sections: [...draft.sections, emptySection(draft.participants)] })}><Icon name="arrow" size={15} />Add section</button>
      </div>

      <aside className={styles.summary} aria-label="Summary">
        <div className={styles.summaryCard}>
          <span className={shared.eyebrow}>LIVE SUMMARY</span>
          <dl className={styles.facts}>
            <div><dt>Active</dt><dd>{compiled.plan ? displayTime(compiled.plan.durationMs) : '—'}</dd></div>
            <div><dt>With prep</dt><dd>{compiled.plan ? displayTime(compiled.plan.durationMs + draft.prepMs) : '—'}</dd></div>
          </dl>
          {difficulty && <DifficultyChip difficulty={difficulty} detailed />}
          {compiled.plan && <ul className={styles.sectionList}>{compiled.plan.sections.map(section => <li key={section.id}><span>{section.title}</span><span>{displayTime(section.durationMs)}</span></li>)}</ul>}
          {(issues.length > 0 || compiled.error) && <ul className={styles.issues} role="alert">{issues.map(issue => <li key={issue.path}>{issue.message}</li>)}{compiled.error && <li>{compiled.error}</li>}</ul>}
          <p className={styles.status} aria-live="polite">{dirty ? 'Unsaved changes…' : savedAt ? `Draft saved on this device · ${new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Drafts save automatically on this device.'}</p>
          <div className={styles.saveActions}>
            <button type="button" className={shared.primaryButton} disabled={!canSave} onClick={() => onSave(draft)}><Icon name="check" />{mode === 'replace' ? 'Save changes' : 'Save to library'}</button>
            <button type="button" className={shared.quietButton} onClick={() => setDiscarding(true)}>Discard draft</button>
          </div>
        </div>
      </aside>
    </div>

    <ConfirmDialog open={discarding} title="Discard this draft?" confirmLabel="Discard" cancelLabel="Keep editing" onClose={() => setDiscarding(false)} onConfirm={() => { setDiscarding(false); onDiscard(); }}>
      <p>{mode === 'replace' ? 'The saved workout stays as it was. Your unsaved edits are removed from this device.' : 'The draft is removed from this device.'}</p>
    </ConfirmDialog>
  </div>;
}
