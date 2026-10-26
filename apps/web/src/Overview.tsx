import { useMemo, useState } from 'react';
import { formatDuration } from '../../../packages/domain/src';
import { compileWorkout, type Phase } from '../../../packages/domain/src/compiler';
import { outlineWorkout } from '../../../packages/domain/src/outline';
import { displayTime } from '../../../packages/engine/src';
import type { LibraryEntry } from './Library';
import { exportWorkoutFile } from './Player';
import { editHref, playHref } from './router';
import { ConfirmDialog } from './ConfirmDialog';
import { DifficultyChip } from './DifficultyChip';
import { Icon } from './Icon';
import styles from './Overview.module.css';
import shared from './App.module.css';

const REST_NAMES: Record<Phase, string> = { work: 'work', transition: 'transition', roundRest: 'round rest', blockRest: 'block rest' };
const restText = (segments: { kind: Phase; ms: number }[]) => segments.map(segment => `${formatDuration(segment.ms)} ${REST_NAMES[segment.kind]}`).join(' + ');

interface OverviewProps { entry: LibraryEntry; names: { A: string; B: string }; onRemove: (id: string) => void }

/** The study view: everything the athletes will see, round by round, before anyone presses Start. */
export function Overview({ entry, names, onRemove }: OverviewProps) {
  const { workout, summary, source, editable } = entry;
  const [removing, setRemoving] = useState(false);
  const plan = useMemo(() => compileWorkout(workout), [workout]);
  const sections = useMemo(() => outlineWorkout(plan), [plan]);
  const pair = workout.participants === 2;
  const attribution = workout.attribution;
  const movementCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of plan.occurrences) if (item.phase === 'work') for (const lane of [item.assignments?.A, item.assignments?.B]) if (lane) counts.set(lane.name, (counts.get(lane.name) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en'));
  }, [plan]);

  return <div className={styles.overview}>
    <div className={shared.workoutHeading}>
      <div>
        <div className={shared.eyebrow}><a href="#/">YOUR LIBRARY</a> <span>/</span> {pair ? 'PARTNER SESSION' : 'SOLO SESSION'}{source === 'saved' && <><span>/</span>SAVED ON THIS DEVICE</>}</div>
        <h1>{workout.title}</h1>
        {workout.description && <p className={shared.description}>{workout.description}</p>}
        {attribution && <p className={styles.attribution}>{attribution.author && <span>By {attribution.author}</span>}{attribution.sourceUrl && <a href={attribution.sourceUrl} target="_blank" rel="noreferrer noopener">Source</a>}{attribution.licence && <span>{attribution.licence}</span>}{attribution.notes && <span>{attribution.notes}</span>}</p>}
        <div className={shared.metadata}><span><Icon name="clock" size={16} />{displayTime(summary.totalMs)} incl. prep</span><span><Icon name={pair ? 'users' : 'user'} size={16} />{pair ? '2 athletes' : 'Solo'}</span>{workout.equipment.length > 0 && <span className={shared.equipment}>{workout.equipment.join(' + ')}</span>}<DifficultyChip difficulty={summary.difficulty} detailed /></div>
      </div>
      <div className={styles.actions}>
        <a className={shared.primaryButton} href={playHref(workout.id)}><Icon name="play" />Start workout</a>
        {editable && <a className={shared.quietButton} href={editHref(workout.id)}><Icon name="settings" size={16} />{source === 'saved' ? 'Edit' : 'Duplicate and edit'}</a>}
        <button className={shared.quietButton} onClick={() => exportWorkoutFile(workout)}><Icon name="download" size={17} />Export</button>
        {source === 'saved' && <button className={shared.quietButton} onClick={() => setRemoving(true)}><Icon name="trash" size={17} />Remove</button>}
      </div>
    </div>

    <dl className={styles.facts} aria-label="At a glance">
      <div><dt>Active time</dt><dd>{displayTime(summary.activeMs)}</dd></div>
      <div><dt>Prep</dt><dd>{formatDuration(workout.prepMs)}</dd></div>
      <div><dt>Sections</dt><dd>{sections.length}</dd></div>
      <div><dt>Movements</dt><dd>{summary.movements.length}</dd></div>
      <div><dt>Ready gates</dt><dd>{Math.max(0, sections.filter((section, index) => index < sections.length - 1 && section.transitionAfter === 'manualReady').length)}</dd></div>
    </dl>

    <ol className={styles.sections} aria-label="Sections">
      {sections.map((section, index) => <li key={section.id} className={styles.section}>
        <div className={styles.sectionHeading}>
          <div><span className={shared.eyebrow}>SECTION {index + 1} OF {sections.length}</span><h2>{section.title}</h2></div>
          <div className={styles.sectionFacts}><span>{displayTime(section.durationMs)}</span><span>{index < sections.length - 1 ? section.transitionAfter === 'manualReady' ? 'Then wait for Ready' : 'Then continues automatically' : 'Final section'}</span></div>
        </div>
        {section.leadingRest.length > 0 && <p className={styles.restNote}>Starts with {restText(section.leadingRest)}.</p>}
        {section.rounds.map((round, roundIndex) => <div key={roundIndex} className={styles.round}>
          {(round.label || round.roundRestMs > 0) && <div className={styles.roundHeading}><strong>{round.label || 'Once through'}</strong>{round.roundRestMs > 0 && <span>{formatDuration(round.roundRestMs)} rest between rounds</span>}</div>}
          <table className={styles.table}>
            <thead><tr><th scope="col">#</th><th scope="col">{pair ? `A · ${names.A}` : 'Movement'}</th>{pair && <th scope="col">B · {names.B}</th>}<th scope="col">Work</th><th scope="col">Then</th></tr></thead>
            <tbody>{round.rows.map((row, rowIndex) => <tr key={row.anchor + rowIndex}>
              <td>{String(rowIndex + 1).padStart(2, '0')}</td>
              <td>{row.A?.name}{row.A?.reps || row.A?.load ? <small>{[row.A.reps ? `${row.A.reps} reps` : '', row.A.load ? `${row.A.load.value} ${row.A.load.unit}` : ''].filter(Boolean).join(' · ')}</small> : null}</td>
              {pair && <td>{row.B?.name}{row.B?.reps || row.B?.load ? <small>{[row.B.reps ? `${row.B.reps} reps` : '', row.B.load ? `${row.B.load.value} ${row.B.load.unit}` : ''].filter(Boolean).join(' · ')}</small> : null}</td>}
              <td>{formatDuration(row.workMs)}</td>
              <td>{row.restAfter.length ? restText(row.restAfter) : rowIndex === round.rows.length - 1 ? (round.roundRestMs && round.repetitions > 1 ? 'Round rest' : '—') : 'Next'}</td>
            </tr>)}</tbody>
          </table>
          {round.restAfter.length > 0 && <p className={styles.restNote}>Then {restText(round.restAfter)}.</p>}
        </div>)}
      </li>)}
    </ol>

    <section className={styles.movements} aria-label="Movements">
      <h2>Movements</h2>
      <ul>{movementCounts.map(([name, count]) => <li key={name}><span>{name}</span><small>×{count}</small></li>)}</ul>
    </section>

    <ConfirmDialog open={removing} title={`Remove “${summary.title}”?`} confirmLabel="Remove workout" cancelLabel="Keep it" onClose={() => setRemoving(false)} onConfirm={() => { setRemoving(false); onRemove(workout.id); window.location.hash = '#/'; }}>
      <p>It disappears from this device. Export it first if you want to keep a copy.</p>
    </ConfirmDialog>
  </div>;
}
