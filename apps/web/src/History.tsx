import { useEffect, useMemo, useState } from 'react';
import { displayTime } from '../../../packages/engine/src';
import type { SectionResult } from '../../../packages/engine/src';
import type { SessionRecord } from '../../../packages/engine/src/records';
import type { Catalogue } from '../../../packages/domain/src/catalogue';
import type { WorkoutAudio } from './audio';
import { Chip } from './Chip';
import { ConfirmDialog } from './ConfirmDialog';
import { Icon } from './Icon';
import type { LibraryEntry } from './Library';
import { Player, resultText } from './Player';
import type { Preferences } from './preferences';
import { playHref, snapshotPlayHref, workoutHref } from './router';
import type { SessionView } from './data/use-library-data';
import { DONE_THRESHOLD } from './session-log';
import styles from './History.module.css';
import shared from './App.module.css';

interface HistoryProps {
  sessions: SessionView[];
  entries: LibraryEntry[];
  onCorrect: (id: string, results: SectionResult[], note?: string) => Promise<boolean>;
  onLoadMore: () => Promise<void>;
  fetchSession: (id: string) => Promise<(SessionRecord & { receivedAt: string }) | undefined>;
}

const OUTCOME: Record<SessionView['outcome'], string> = { completed: 'Completed', capped: 'Capped', aborted: 'Ended early' };
const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const parseTime = (text: string): number | undefined => { const match = /^(\d+):([0-5]\d)$/.exec(text.trim()); return match ? (Number(match[1]) * 60 + Number(match[2])) * 1000 : undefined; };

/** Every session the household has played, newest first: outcome, flags, scores, Repeat, and score corrections (DAT-05). */
export function History({ sessions, entries, onCorrect, onLoadMore, fetchSession }: HistoryProps) {
  const [correcting, setCorrecting] = useState<SessionView>();
  const [loadingMore, setLoadingMore] = useState(false);
  const entryOf = (id: string) => entries.find(entry => entry.workout.id === id);
  return <div className={styles.history}>
    <div className={shared.workoutHeading}><div><div className={shared.eyebrow}><a href="#/">YOUR LIBRARY</a> <span>/</span> HISTORY</div><h1>What you have done</h1><p className={shared.description}>Every session the household played, newest first. Repeat one, or correct a score; the earlier value stays on record.</p></div></div>
    {sessions.length === 0 ? <div className={styles.empty}><h2>Nothing yet</h2><p>Finish a workout and it shows up here.</p></div> : <ul className={styles.list} aria-label="Sessions">
      {sessions.map(session => {
        const entry = entryOf(session.workoutId);
        const done = session.outcome !== 'aborted' || session.completion >= DONE_THRESHOLD;
        return <li key={session.id} className={styles.row} data-pending={session.pending || undefined}>
          <div className={styles.rowTop}>
            <span className={styles.when}>{when(session.finishedAt)}</span>
            <span className={styles.chips}>
              <Chip kind={done ? 'done' : 'neutral'} icon={done ? 'check' : undefined}>{OUTCOME[session.outcome]}{session.outcome === 'aborted' ? ` · ${Math.round(session.completion * 100)} %` : ''}</Chip>
              {session.interrupted && <Chip kind="neutral" icon="alert" title="Recovered from a checkpoint after a reload or a closed tab">Interrupted</Chip>}
              {session.modified && <Chip kind="neutral" title="Steps were skipped or repeated during the session">Modified</Chip>}
              {(session.revision ?? 1) > 1 && <Chip kind="neutral" icon="edit" title="The score was corrected; the earlier value is kept">Corrected</Chip>}
              {session.pending && <Chip kind="neutral" icon="upload" title="Waiting for the household server">Not yet uploaded</Chip>}
            </span>
          </div>
          <h2>{entry ? <a href={workoutHref(session.workoutId)}>{session.title}</a> : session.title}</h2>
          <p className={styles.scores}>{displayTime(session.activeMs, 'floor')} active{session.results.length ? ` · ${session.results.map(resultText).join(' · ')}` : ''}</p>
          <div className={styles.actions}>
            <a className={shared.quietButton} href={entry ? playHref(session.workoutId) : snapshotPlayHref(session.id)} title={entry ? undefined : 'The workout is no longer in the library; this plays the copy saved with the session'}><Icon name="play" size={15} />Repeat</a>
            {!session.pending && session.results.length > 0 && <button type="button" className={shared.quietButton} onClick={() => setCorrecting(session)}><Icon name="edit" size={15} />Correct score</button>}
          </div>
        </li>;
      })}
    </ul>}
    {sessions.length >= 50 && <div><button type="button" className={shared.quietButton} disabled={loadingMore} onClick={() => { setLoadingMore(true); void onLoadMore().finally(() => setLoadingMore(false)); }}>Load earlier sessions</button></div>}
    {correcting && <CorrectionDialog session={correcting} fetchSession={fetchSession} onClose={() => setCorrecting(undefined)} onSave={async (results, note) => { const ok = await onCorrect(correcting.id, results, note); if (ok) setCorrecting(undefined); }} />}
  </div>;
}

function CorrectionDialog({ session, fetchSession, onClose, onSave }: { session: SessionView; fetchSession: HistoryProps['fetchSession']; onClose: () => void; onSave: (results: SectionResult[], note?: string) => Promise<void> }) {
  const [results, setResults] = useState<SectionResult[]>(() => structuredClone(session.results));
  const [times, setTimes] = useState<string[]>(() => session.results.map(result => displayTime(result.sectionMs, 'floor')));
  const [note, setNote] = useState('');
  const [history, setHistory] = useState<SessionRecord['corrections']>();
  useEffect(() => { if ((session.revision ?? 1) > 1) void fetchSession(session.id).then(full => setHistory(full?.corrections)); }, [session, fetchSession]);
  const valid = useMemo(() => times.every((time, index) => results[index].format !== 'forTime' && results[index].format !== 'strength' || parseTime(time) !== undefined), [times, results]);
  const update = (index: number, patch: Partial<SectionResult>) => setResults(current => current.map((result, at) => at === index ? { ...result, ...patch } : result));
  return <ConfirmDialog open title={`Correct the score of “${session.title}”`} confirmLabel="Save correction" cancelLabel="Keep as is" onClose={onClose} onConfirm={() => { if (!valid) return; const fixed = results.map((result, index) => parseTime(times[index]) !== undefined && (result.format === 'forTime' || result.format === 'strength') ? { ...result, sectionMs: parseTime(times[index])! } : result); void onSave(fixed, note.trim() || undefined); }}>
    <div className={styles.form}>
      {results.map((result, index) => <fieldset key={result.sectionId} className={styles.section}>
        <legend>{result.sectionId}</legend>
        {result.counter && <div className={styles.pair}>
          <label>Rounds<input type="number" min={0} value={result.counter.rounds} onChange={event => update(index, { counter: { rounds: Math.max(0, Number(event.target.value) || 0), reps: result.counter!.reps } })} /></label>
          <label>Reps<input type="number" min={0} value={result.counter.reps} onChange={event => update(index, { counter: { rounds: result.counter!.rounds, reps: Math.max(0, Number(event.target.value) || 0) } })} /></label>
        </div>}
        {(result.format === 'forTime' || result.format === 'strength') && <label>Time (mm:ss)<input value={times[index]} onChange={event => setTimes(current => current.map((time, at) => at === index ? event.target.value : time))} aria-invalid={parseTime(times[index]) === undefined ? true : undefined} /></label>}
        {result.teamRounds !== undefined && <div className={styles.pair}>
          <label>Team rounds<input type="number" min={0} value={result.teamRounds} onChange={event => update(index, { teamRounds: Math.max(0, Number(event.target.value) || 0) })} /></label>
          <label>Turns<input type="number" min={0} value={result.turns ?? 0} onChange={event => update(index, { turns: Math.max(0, Number(event.target.value) || 0) })} /></label>
        </div>}
      </fieldset>)}
      <label>Note<input value={note} maxLength={500} placeholder="Why the score changes" onChange={event => setNote(event.target.value)} /></label>
      <p className={styles.prior}>Current: {session.results.map(resultText).join(' · ')}</p>
      {history?.map((item, index) => <p key={index} className={styles.prior}>Before {when(item.correctedAt)}: {item.previousResults.map(resultText).join(' · ')}{item.note ? ` (${item.note})` : ''}</p>)}
    </div>
  </ConfirmDialog>;
}

interface SnapshotPlayerProps {
  sessionId: string;
  fetchSession: HistoryProps['fetchSession'];
  audio: WorkoutAudio;
  preferences: Preferences;
  catalogue: Catalogue;
  onPreferencesChange: (update: (value: Preferences) => Preferences) => void;
  onPerformingChange: (performing: boolean) => void;
  onSessionEnd: (record: SessionRecord) => void;
  onSessionClear?: (sessionId: string) => void;
}

/** Plays the workout exactly as it was saved with a past session, for workouts that have since left the library (DAT-05/09). */
export function SnapshotPlayer({ sessionId, fetchSession, ...player }: SnapshotPlayerProps) {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'missing' } | { status: 'ready'; record: SessionRecord }>({ status: 'loading' });
  useEffect(() => { let cancelled = false; void fetchSession(sessionId).then(record => { if (!cancelled) setState(record?.workout ? { status: 'ready', record } : { status: 'missing' }); }); return () => { cancelled = true; }; }, [sessionId, fetchSession]);
  if (state.status === 'loading') return <p className={shared.notice} role="status">Loading the saved workout…</p>;
  if (state.status === 'missing') return <p className={shared.notice} role="status">That session has no saved workout to repeat. <a href="#/history">Back to history</a>.</p>;
  return <Player key={sessionId} workout={state.record.workout!} {...player} />;
}
