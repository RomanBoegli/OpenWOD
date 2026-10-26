import { useMemo, useState } from 'react';
import { formatDuration } from '../../../packages/domain/src';
import { compileWorkout, type Phase } from '../../../packages/domain/src/compiler';
import { outlineWorkout } from '../../../packages/domain/src/outline';
import type { Workout } from '../../../packages/domain/src/schema';
import { prescriptionText } from '../../../packages/domain/src/prescription';
import { FORMAT_LABELS, type Prescription } from '../../../packages/domain/src/schema';
import { LoadLevels } from './LevelChip';
import { AthletesChip, Chip, FormatChips } from './Chip';
import type { LoadUnit, Sex } from '../../../packages/domain/src/prescription';
import type { Collection } from './master-data';
import { agoText } from './session-log';
import type { SessionView } from './data/use-library-data';
import { resultText } from './Player';
import { displayTime } from '../../../packages/engine/src';
import type { LibraryEntry } from './Library';
import { editHref, playHref } from './router';
import { ConfirmDialog } from './ConfirmDialog';
import { DifficultyChip } from './DifficultyChip';
import { Icon } from './Icon';
import styles from './Overview.module.css';
import shared from './App.module.css';

const REST_NAMES: Record<Phase, string> = { work: 'work', transition: 'transition', roundRest: 'round rest', blockRest: 'block rest' };
const restText = (segments: { kind: Phase; ms: number }[]) => segments.map(segment => `${formatDuration(segment.ms)} ${REST_NAMES[segment.kind]}`).join(' + ');

interface OverviewProps { entry: LibraryEntry; names: { A: string; B: string }; collections: Collection[]; sessions: SessionView[]; loadsFor: { A: Sex; B: Sex }; loadUnit: LoadUnit; onRemove: (id: string) => void; onExport: (workout: Workout) => void }

/** The study view: everything the athletes will see, round by round, before anyone presses Start. */
/** Targets only (no fallback hint), for table cells; loads are shown per level separately. */
const targetText = (value: Prescription) => value.reps || value.calories || value.distance || value.timeMs ? prescriptionText({ ...value, load: undefined }) : '';
export function Overview({ entry, names, collections, sessions, loadsFor, loadUnit, onRemove, onExport }: OverviewProps) {
  const { workout, summary, source, editable } = entry;
  const cell = (value: Prescription | undefined, role: 'A' | 'B') => value ? <>{value.name}{targetText(value) ? <small>{targetText(value)}</small> : null}{value.load ? <small><LoadLevels load={value.load} unit={loadUnit} sex={workout.participants === 2 ? loadsFor[role] : undefined} /></small> : null}</> : null;
  const [removing, setRemoving] = useState(false);
  const plan = useMemo(() => compileWorkout(workout), [workout]);
  const sections = useMemo(() => outlineWorkout(plan), [plan]);
  const pair = workout.participants === 2;
  const attribution = workout.attribution;
  const movementCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of plan.occurrences) if (item.phase === 'work') for (const lane of item.tasks ? item.tasks.flatMap(task => [task.assignments.A, task.assignments.B]) : [item.assignments?.A, item.assignments?.B]) if (lane) counts.set(lane.name, (counts.get(lane.name) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en'));
  }, [plan]);

  return <div className={styles.overview}>
    <div className={shared.workoutHeading}>
      <div>
        <div className={shared.eyebrow}><a href="#/">YOUR LIBRARY</a> <span>/</span> {pair ? 'PARTNER SESSION' : 'SOLO SESSION'}{source === 'saved' && <><span>/</span>SAVED ON THIS DEVICE</>}</div>
        <h1>{workout.title}</h1>
        {workout.description && <p className={shared.description}>{workout.description}</p>}
        {attribution && <p className={styles.attribution}>{attribution.author && <span>By {attribution.author}</span>}{attribution.sourceUrl && <a href={attribution.sourceUrl} target="_blank" rel="noreferrer noopener">Source</a>}{attribution.licence && <span>{attribution.licence}</span>}{attribution.notes && <span>{attribution.notes}</span>}</p>}
        <div className={shared.metadata}><span><Icon name="clock" size={16} />{summary.durationKind === 'open' ? 'Open-ended' : `${summary.durationKind === 'capped' ? 'Up to ' : ''}${displayTime(summary.totalMs)} incl. prep`}</span><AthletesChip participants={workout.participants} /><FormatChips formats={summary.formats} />{collections.map(collection => <Chip key={collection.id} kind="collection">{collection.title}</Chip>)}<DifficultyChip difficulty={summary.difficulty} detailed />{sessions.length > 0 && <Chip kind="done" icon="check">{sessions.length === 1 ? 'Done once' : `Done ${sessions.length}×`} · {agoText(sessions[0].finishedAt)}</Chip>}</div>
      </div>
      <div className={styles.actions}>
        <a className={shared.primaryButton} href={playHref(workout.id)}><Icon name="play" />Start workout</a>
        {editable && <a className={shared.quietButton} href={editHref(workout.id)}><Icon name={source === 'saved' ? 'edit' : 'copy'} size={16} />{source === 'saved' ? 'Edit' : 'Duplicate and edit'}</a>}
        <button className={shared.quietButton} onClick={() => onExport(workout)}><Icon name="download" size={17} />Export</button>
        {source === 'saved' && <button className={shared.quietButton} onClick={() => setRemoving(true)}><Icon name="trash" size={17} />Remove</button>}
      </div>
    </div>

    <dl className={styles.facts} aria-label="At a glance">
      <div><dt>{summary.durationKind === 'exact' ? 'Active time' : summary.durationKind === 'capped' ? 'Up to' : 'Timed parts'}</dt><dd>{displayTime(summary.activeMs)}</dd></div>
      <div><dt>Prep</dt><dd>{formatDuration(workout.prepMs)}</dd></div>
      <div><dt>Sections</dt><dd>{sections.length}</dd></div>
      <div><dt>Movements</dt><dd>{summary.movements.length}</dd></div>
      <div><dt>Ready gates</dt><dd>{Math.max(0, sections.filter((section, index) => index < sections.length - 1 && section.transitionAfter === 'manualReady').length)}</dd></div>
    </dl>

    <ol className={styles.sections} aria-label="Sections">
      {sections.map((section, index) => <li key={section.id} className={styles.section}>
        <div className={styles.sectionHeading}>
          <div><span className={shared.eyebrow}>SECTION {index + 1} OF {sections.length} <span>/</span> {FORMAT_LABELS[section.format].toUpperCase()}</span><h2>{section.title}</h2></div>
          <div className={styles.sectionFacts}><span>{section.durationKind === 'open' ? 'Open' : section.durationKind === 'capped' ? `Cap ${displayTime(section.capMs ?? section.durationMs)}` : displayTime(section.durationMs)}</span>{section.emom && <span>{section.emom.intervals} × {formatDuration(section.emom.intervalMs)}</span>}{section.youGoIGo?.rounds && <span>{section.youGoIGo.rounds} team rounds</span>}{section.youGoIGo?.turnMs && <span>{formatDuration(section.youGoIGo.turnMs)} per turn</span>}<span>{index < sections.length - 1 ? section.transitionAfter === 'manualReady' ? 'Then wait for Ready' : 'Then continues automatically' : 'Final section'}</span></div>
        </div>
        {section.leadingRest.length > 0 && <p className={styles.restNote}>Starts with {restText(section.leadingRest)}.</p>}
        {section.rounds.map((round, roundIndex) => <div key={roundIndex} className={styles.round}>
          {(round.label || round.roundRestMs > 0 || round.block) && <div className={styles.roundHeading}><strong>{round.block ? section.format === 'amrap' ? 'One round of the block · repeat until the cap' : 'One turn · then switch' : round.label || 'Once through'}</strong>{round.roundRestMs > 0 && <span>{formatDuration(round.roundRestMs)} rest between {section.format === 'strength' ? 'sets' : 'rounds'}</span>}</div>}
          <table className={styles.table}>
            <thead><tr><th scope="col">#</th><th scope="col">{pair ? `A · ${names.A}` : 'Movement'}</th>{pair && <th scope="col">B · {names.B}</th>}<th scope="col">{round.block ? 'Clock' : 'Work'}</th><th scope="col">Then</th></tr></thead>
            <tbody>{round.rows.map((row, rowIndex) => <tr key={row.anchor + rowIndex}>
              <td>{String(rowIndex + 1).padStart(2, '0')}</td>
              <td>{cell(row.A, 'A')}</td>
              {pair && <td>{cell(row.B, 'B')}</td>}
              <td>{row.workMs !== undefined ? formatDuration(row.workMs) : round.block ? 'Your pace' : row.completion === 'both' ? 'Until both tap Done' : 'Until Done'}</td>
              <td>{row.restAfter.length ? restText(row.restAfter) : rowIndex === round.rows.length - 1 ? (round.block ? 'Next round' : round.roundRestMs && round.repetitions > 1 ? section.format === 'strength' ? 'Rest' : 'Round rest' : '—') : 'Next'}</td>
            </tr>)}</tbody>
          </table>
          {round.restAfter.length > 0 && <p className={styles.restNote}>Then {restText(round.restAfter)}.</p>}
        </div>)}
      </li>)}
    </ol>

    <div className={styles.lists}>
      <section className={styles.movements} aria-label="Movements">
        <h2>Movements</h2>
        <ul>{movementCounts.map(([name, count]) => <li key={name}><span>{name}</span><small>×{count}</small></li>)}</ul>
      </section>
      <section className={styles.movements} aria-label="Equipment">
        <h2>Equipment</h2>
        {summary.equipmentNeeded.length > 0 ? <ul>{summary.equipmentNeeded.map(item => <li key={item}><span>{item}</span></li>)}</ul> : <p className={styles.restNote}>Bodyweight only. Nothing to set up.</p>}
      </section>
    </div>
    {sessions.length > 0 && <section className={styles.history} aria-label="Past sessions">
      <h2>Past sessions</h2>
      <ul>{sessions.slice(0, 10).map(session => <li key={session.id}><span>{new Date(session.finishedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span><span>{session.outcome === 'completed' ? 'Completed' : session.outcome === 'capped' ? 'Capped' : `Ended at ${Math.round(session.completion * 100)} %`}{session.interrupted ? ' · interrupted' : ''} · {displayTime(session.activeMs, 'floor')} active</span><span>{session.results.map(result => resultText(result)).join(' · ')}</span></li>)}</ul>
    </section>}

    <ConfirmDialog open={removing} title={`Remove “${summary.title}”?`} confirmLabel="Remove workout" cancelLabel="Keep it" onClose={() => setRemoving(false)} onConfirm={() => { setRemoving(false); onRemove(workout.id); window.location.hash = '#/'; }}>
      <p>It disappears from this device. Export it first if you want to keep a copy.</p>
    </ConfirmDialog>
  </div>;
}
