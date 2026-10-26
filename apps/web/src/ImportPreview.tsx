import { useMemo, useState } from 'react';
import { FORMAT_LABELS } from '../../../packages/domain/src/schema';
import type { Workout } from '../../../packages/domain/src/schema';
import { summariseWorkout } from '../../../packages/domain/src/library';
import type { DifficultyCalibration } from '../../../packages/domain/src/difficulty';
import type { PackCollection, SharedFile } from '../../../packages/domain/src/pack';
import type { PackDecision } from './data/remote';
import type { LibraryEntry } from './Library';
import { durationLabel } from './Library';
import { Icon } from './Icon';
import styles from './ImportPreview.module.css';
import shared from './App.module.css';

/**
 * What an import will do before it does it (SHR-04): every workout with its title, formats, athletes, timing,
 * equipment and attribution, and a state from its sharing provenance. Known provenance means Skip by default; a
 * newer revision of something imported before can replace it; an id that is taken is remapped on the server.
 */
export type RowState = 'new' | 'renamed' | 'already' | 'newer';
export interface ImportRow { workout: Workout; state: RowState; match?: LibraryEntry; decision: PackDecision }

export function rowsFor(workouts: Workout[], entries: LibraryEntry[]): ImportRow[] {
  const taken = new Set(entries.map(entry => entry.workout.id));
  return workouts.map(workout => {
    const match = workout.sharing ? entries.find(entry => entry.workout.sharing?.id === workout.sharing!.id) : undefined;
    if (match && match.workout.sharing!.sourceRevision >= workout.sharing!.sourceRevision) return { workout, state: 'already', match, decision: { action: 'skip' } };
    if (match) return { workout, state: 'newer', match, decision: match.source === 'saved' ? { action: 'replace', id: match.workout.id, expectedRevision: match.workout.revision } : { action: 'copy' } };
    return { workout, state: taken.has(workout.id) ? 'renamed' : 'new', decision: { action: 'copy' } };
  });
}

interface ImportPreviewProps {
  file: SharedFile;
  fileName: string;
  entries: LibraryEntry[];
  difficulty: DifficultyCalibration;
  /** A single editable workout can also open as a draft instead of being imported. */
  onOpenInEditor?: (workout: Workout) => void;
  onConfirm: (workouts: Workout[], collections: PackCollection[], decisions: Record<string, PackDecision>) => Promise<void>;
  onClose: () => void;
}

const STATE_TEXT: Record<RowState, string> = { new: 'New', renamed: 'New · id taken, will be renamed', already: 'Already in your library', newer: 'Newer version of one you imported' };

export function ImportPreview({ file, fileName, entries, difficulty, onOpenInEditor, onConfirm, onClose }: ImportPreviewProps) {
  const workouts = file.kind === 'pack' ? file.pack.workouts : [file.workout];
  const collections = file.kind === 'pack' ? file.pack.collections : [];
  const [rows, setRows] = useState<ImportRow[]>(() => rowsFor(workouts, entries));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const summaries = useMemo(() => new Map(workouts.map(workout => [workout.id, summariseWorkout(workout, { difficulty })])), [workouts, difficulty]);
  const importing = rows.filter(row => row.decision.action !== 'skip').length;
  const single = file.kind === 'workout';
  const setDecision = (id: string, decision: PackDecision) => setRows(current => current.map(row => row.workout.id === id ? { ...row, decision } : row));
  const confirm = async () => {
    setBusy(true); setError('');
    try { await onConfirm(workouts, collections, Object.fromEntries(rows.map(row => [row.workout.id, row.decision]))); } catch (failure) { setError(failure instanceof Error ? failure.message : 'The import failed.'); setBusy(false); }
  };
  return <div className={styles.preview}>
    <p className={shared.dialogIntro}>{file.kind === 'pack' ? `Pack “${file.pack.title ?? fileName}” with ${workouts.length} ${workouts.length === 1 ? 'workout' : 'workouts'}${collections.length ? ` and ${collections.length} ${collections.length === 1 ? 'collection' : 'collections'}` : ''}.` : `One workout from ${fileName}.`} Imports become copies in your library; nothing starts until you press Start.</p>
    <ul className={styles.rows} aria-label="Workouts in the file">
      {rows.map(row => {
        const summary = summaries.get(row.workout.id)!;
        const attribution = row.workout.attribution;
        return <li key={row.workout.id} className={styles.row} data-state={row.state}>
          <div className={styles.rowMain}>
            <h3>{row.workout.title}</h3>
            <p className={styles.facts}>{durationLabel(summary)} incl. prep · {row.workout.participants === 2 ? '2 athletes' : 'Solo'} · {summary.formats.map(item => FORMAT_LABELS[item]).join(', ')} · {summary.movements.length} movements · projected {summary.difficulty.label.toLowerCase()}</p>
            {summary.equipmentNeeded.length > 0 && <p className={styles.facts}>{summary.equipmentNeeded.join(' + ')}</p>}
            {attribution && <p className={styles.attribution}>{[attribution.author ? `By ${attribution.author}` : '', attribution.sourceUrl ?? '', attribution.licence ?? '', attribution.notes ?? ''].filter(Boolean).join(' · ')}</p>}
            <p className={styles.state}>{STATE_TEXT[row.state]}{row.match && row.state !== 'already' ? ` (“${row.match.summary.title}”)` : ''}{row.state === 'already' && row.match ? ` as “${row.match.summary.title}”` : ''}</p>
          </div>
          <label className={styles.decision}>Action<select value={row.decision.action} aria-label={`Action for ${row.workout.title}`} onChange={event => {
            const action = event.target.value as PackDecision['action'];
            setDecision(row.workout.id, action === 'replace' && row.match ? { action: 'replace', id: row.match.workout.id, expectedRevision: row.match.workout.revision } : action === 'skip' ? { action: 'skip' } : { action: 'copy' });
          }}>
            <option value="copy">{row.state === 'already' || row.state === 'newer' ? 'Import another copy' : 'Import'}</option>
            <option value="skip">Skip</option>
            {row.state === 'newer' && row.match?.source === 'saved' && <option value="replace">Replace “{row.match.summary.title}”</option>}
          </select></label>
        </li>;
      })}
    </ul>
    {collections.length > 0 && <p className={shared.dialogIntro}>Collections in the pack: {collections.map(collection => `${collection.title} (${collection.workoutIds.length})`).join(', ')}. They are created as your own collections with the imported copies.</p>}
    {rows.some(row => row.decision.action === 'replace') && <p className={shared.notice} role="status">Replacing keeps the local id and bumps its revision; past sessions keep the workout as it was played.</p>}
    {error && <p role="alert" className={shared.importError}>{error}</p>}
    <div className={shared.dialogActions}>
      <button type="button" className={shared.quietButton} onClick={onClose}>Cancel</button>
      {single && onOpenInEditor && <button type="button" className={shared.quietButton} onClick={() => onOpenInEditor(workouts[0])}><Icon name="edit" size={15} />Open in editor</button>}
      <button type="button" className={shared.primaryButton} disabled={busy || importing === 0} onClick={() => void confirm()}>{busy ? 'Importing…' : single ? 'Save to library' : `Import ${importing} ${importing === 1 ? 'workout' : 'workouts'}`}<Icon name="arrow" /></button>
    </div>
  </div>;
}
