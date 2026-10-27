import { useEffect, useState } from 'react';
import { displayTime } from '../../../packages/engine/src';
import type { SectionResult } from '../../../packages/engine/src';
import type { SessionRecord } from '../../../packages/engine/src/records';
import type { Catalogue } from '../../../packages/domain/src/catalogue';
import type { WorkoutAudio } from './audio';
import { Chip } from './Chip';
import { ConfirmDialog } from './ConfirmDialog';
import { Icon } from './Icon';
import { TimeInput } from './TimeInput';
import type { LibraryEntry } from './Library';
import { Player } from './Player';
import { sessionScore } from './session-log';
import type { Preferences } from './preferences';
import { LOGBOOK_HREF, playHref, snapshotPlayHref, workoutHref } from './router';
import type { SessionView } from './data/use-library-data';
import type { DataMode } from './data/mode';
import styles from './History.module.css';
import settings from './Settings.module.css';
import shared from './App.module.css';

export interface LogbookProps {
  mode: DataMode;
  sessions: SessionView[];
  entries: LibraryEntry[];
  onCorrect: (id: string, results: SectionResult[], note?: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  /** Reads the next page; false when it was the last. */
  onLoadMore: () => Promise<boolean>;
  fetchSession: (id: string) => Promise<(SessionRecord & { receivedAt: string }) | undefined>;
}

const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const thisYear = new Date().getFullYear();
/** "Oct 27, 15:59", with the year only when it is not this one. */
const shortWhen = (iso: string) => { const date = new Date(iso); return date.toLocaleString([], { month: 'short', day: 'numeric', ...(date.getFullYear() === thisYear ? {} : { year: 'numeric' }), hour: '2-digit', minute: '2-digit' }); };

/** The page size of the session list (use-library-data SESSION_PAGE): a full first page means there may be more. */
const PAGE = 50;

/**
 * The logbook under Settings (UI-22): every session played, newest first, with outcome, flags, scores, Repeat, score
 * corrections (DAT-05) and Delete (DAT-14).
 */
export function Logbook({ mode, sessions, entries, onCorrect, onDelete, onLoadMore, fetchSession }: LogbookProps) {
  const [correcting, setCorrecting] = useState<SessionView>();
  const [deleting, setDeleting] = useState<SessionView>();
  const [loadingMore, setLoadingMore] = useState(false);
  // Once a full page was listed more may exist, even after a delete shortens the list, until a page comes back short.
  const [paged, setPaged] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  useEffect(() => { if (sessions.length >= PAGE) setPaged(true); }, [sessions.length]);
  const entryOf = (id: string) => entries.find(entry => entry.workout.id === id);
  return <section className={settings.card} aria-labelledby="logbook-title">
    <div className={settings.cardHeading}><h2 id="logbook-title">Logbook</h2><span className={settings.hint}>{sessions.length === 1 ? '1 session' : `${sessions.length}${paged && !exhausted ? '+' : ''} sessions`}</span></div>
    <p className={settings.hint}>{mode === 'static' ? 'Every session played in this browser, newest first.' : 'Every session the household played, newest first.'} Repeat one, correct a score (the earlier value stays on record), or delete a session for good.</p>
    {sessions.length === 0 ? <div className={styles.empty}><h3>Nothing yet</h3><p>Finish a workout and it shows up here.</p></div> : <ul className={styles.list} aria-label="Sessions">
      {sessions.map(session => {
        const entry = entryOf(session.workoutId);
        const outcome = session.outcome === 'capped' ? 'Capped' : session.outcome === 'aborted' ? `Ended early · ${Math.round(session.completion * 100)} %` : undefined;
        const score = sessionScore(session);
        return <li key={session.id} className={styles.row} data-pending={session.pending || undefined}>
          <div className={styles.main}>
            <div className={styles.titleLine}>
              <span className={styles.title}>{entry ? <a href={workoutHref(session.workoutId)}>{session.title}</a> : session.title}</span>
              {outcome && <Chip kind="neutral">{outcome}</Chip>}
              {session.interrupted && <Chip kind="neutral" title="Recovered from a checkpoint after a reload or a closed tab">Interrupted</Chip>}
              {session.modified && <Chip kind="neutral" title="Steps were skipped or repeated during the session">Modified</Chip>}
              {(session.revision ?? 1) > 1 && <Chip kind="neutral" title="The score was corrected; the earlier value is kept">Corrected</Chip>}
              {session.pending && <Chip kind="neutral" title="Waiting for the household server">Not yet uploaded</Chip>}
            </div>
            <p className={styles.meta}><time dateTime={session.finishedAt}>{shortWhen(session.finishedAt)}</time> · {displayTime(session.activeMs, 'floor')}{score ? ` · ${score}` : ''}</p>
          </div>
          <div className={styles.actions}>
            <a className={shared.iconButton} href={entry ? playHref(session.workoutId) : snapshotPlayHref(session.id)} aria-label="Repeat" title={entry ? 'Repeat' : 'Repeat the copy saved with the session: the workout is no longer in the library'}><Icon name="play" size={16} /></a>
            {!session.pending && session.results.length > 0 && <button type="button" className={shared.iconButton} aria-label="Correct score" title="Correct score" onClick={() => setCorrecting(session)}><Icon name="edit" size={16} /></button>}
            <button type="button" className={shared.iconButton} aria-label="Delete" title="Delete" onClick={() => setDeleting(session)}><Icon name="trash" size={16} /></button>
          </div>
        </li>;
      })}
    </ul>}
    {paged && !exhausted && <div><button type="button" className={shared.quietButton} disabled={loadingMore} onClick={() => { setLoadingMore(true); void onLoadMore().then(more => { if (!more) setExhausted(true); }).finally(() => setLoadingMore(false)); }}>Load earlier sessions</button></div>}
    {correcting && <CorrectionDialog session={correcting} fetchSession={fetchSession} onClose={() => setCorrecting(undefined)} onSave={async (results, note) => { const ok = await onCorrect(correcting.id, results, note); if (ok) setCorrecting(undefined); }} />}
    <ConfirmDialog open={Boolean(deleting)} title="Delete this session?" confirmLabel="Delete" cancelLabel="Keep it" onClose={() => setDeleting(undefined)} onConfirm={() => { if (deleting) void onDelete(deleting.id); setDeleting(undefined); }}>
      <p>{deleting ? `${deleting.title}, ${when(deleting.finishedAt)}.` : ''} The session and its score corrections are deleted for good{mode === 'static' ? ' from this browser' : ' on every device'}. This cannot be undone, and restoring an older backup does not bring it back.</p>
    </ConfirmDialog>
  </section>;
}

function CorrectionDialog({ session, fetchSession, onClose, onSave }: { session: SessionView; fetchSession: LogbookProps['fetchSession']; onClose: () => void; onSave: (results: SectionResult[], note?: string) => Promise<void> }) {
  const [results, setResults] = useState<SectionResult[]>(() => structuredClone(session.results));
  const [times, setTimes] = useState<number[]>(() => session.results.map(result => result.sectionMs));
  const [note, setNote] = useState('');
  const [history, setHistory] = useState<SessionRecord['corrections']>();
  useEffect(() => { if ((session.revision ?? 1) > 1) void fetchSession(session.id).then(full => setHistory(full?.corrections)); }, [session, fetchSession]);
  const update = (index: number, patch: Partial<SectionResult>) => setResults(current => current.map((result, at) => at === index ? { ...result, ...patch } : result));
  return <ConfirmDialog open title={`Correct the score of “${session.title}”`} confirmLabel="Save correction" cancelLabel="Keep as is" onClose={onClose} onConfirm={() => { const fixed = results.map((result, index) => result.format === 'forTime' || result.format === 'strength' ? { ...result, sectionMs: times[index] } : result); void onSave(fixed, note.trim() || undefined); }}>
    <div className={styles.form}>
      {results.map((result, index) => <fieldset key={result.sectionId} className={styles.section}>
        <legend>{result.sectionId}</legend>
        {result.counter && <div className={styles.pair}>
          <label>Rounds<input type="number" min={0} value={result.counter.rounds} onChange={event => update(index, { counter: { rounds: Math.max(0, Number(event.target.value) || 0), reps: result.counter!.reps } })} /></label>
          <label>Reps<input type="number" min={0} value={result.counter.reps} onChange={event => update(index, { counter: { rounds: result.counter!.rounds, reps: Math.max(0, Number(event.target.value) || 0) } })} /></label>
        </div>}
        {(result.format === 'forTime' || result.format === 'strength') && <label>Time (mm:ss)<TimeInput value={times[index]} stepMs={1000} onChange={ms => setTimes(current => current.map((time, at) => at === index ? ms : time))} /></label>}
        {result.teamRounds !== undefined && <div className={styles.pair}>
          <label>Team rounds<input type="number" min={0} value={result.teamRounds} onChange={event => update(index, { teamRounds: Math.max(0, Number(event.target.value) || 0) })} /></label>
          <label>Turns<input type="number" min={0} value={result.turns ?? 0} onChange={event => update(index, { turns: Math.max(0, Number(event.target.value) || 0) })} /></label>
        </div>}
      </fieldset>)}
      <label>Note<input value={note} maxLength={500} placeholder="Why the score changes" onChange={event => setNote(event.target.value)} /></label>
      <p className={styles.prior}>Current: {sessionScore({ activeMs: -1, results: session.results }) || 'no score'}</p>
      {history?.map((item, index) => <p key={index} className={styles.prior}>Before {when(item.correctedAt)}: {sessionScore({ activeMs: -1, results: item.previousResults }) || 'no score'}{item.note ? ` (${item.note})` : ''}</p>)}
    </div>
  </ConfirmDialog>;
}

interface SnapshotPlayerProps {
  sessionId: string;
  fetchSession: LogbookProps['fetchSession'];
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
  if (state.status === 'missing') return <p className={shared.notice} role="status">That session has no saved workout to repeat. <a href={LOGBOOK_HREF}>Back to the logbook</a>.</p>;
  return <Player key={sessionId} workout={state.record.workout!} {...player} />;
}
