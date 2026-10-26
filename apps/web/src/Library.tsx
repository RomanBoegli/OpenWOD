import { useMemo, useRef, useState } from 'react';
import { parseWorkoutFile, type Workout } from '../../../packages/domain/src';
import { equipmentOptions, matchesFilter, sortSummaries, summariseWorkout, type DurationBucket, type LibrarySort, type WorkoutSummary } from '../../../packages/domain/src/library';
import { displayTime } from '../../../packages/engine/src';
import { exportWorkoutFile } from './Player';
import { workoutHref } from './router';
import { Icon } from './Icon';
import styles from './Library.module.css';
import shared from './App.module.css';

export interface LibraryEntry { workout: Workout; summary: WorkoutSummary; source: 'bundled' | 'saved' }

export function toEntry(workout: Workout, source: LibraryEntry['source']): LibraryEntry {
  return { workout, summary: summariseWorkout(workout), source };
}

interface LibraryProps {
  entries: LibraryEntry[];
  onImport: (workout: Workout, mode: 'copy' | 'replace') => void;
  onRemove: (id: string) => void;
  storageError: string;
  missingId?: string;
}

export function Library({ entries, onImport, onRemove, storageError, missingId }: LibraryProps) {
  const [query, setQuery] = useState('');
  const [participants, setParticipants] = useState<'' | '1' | '2'>('');
  const [equipment, setEquipment] = useState('');
  const [duration, setDuration] = useState<'' | DurationBucket>('');
  const [sort, setSort] = useState<LibrarySort>('title');
  const [preview, setPreview] = useState<Workout>();
  const [importError, setImportError] = useState('');
  const [removing, setRemoving] = useState<LibraryEntry>();
  const importDialog = useRef<HTMLDialogElement>(null);
  const removeDialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const equipmentList = useMemo(() => equipmentOptions(entries.map(entry => entry.summary)), [entries]);
  const filter = { query, participants: participants ? Number(participants) as 1 | 2 : undefined, equipment: equipment || undefined, duration: duration || undefined };
  const visible = useMemo(() => sortSummaries(entries.filter(entry => matchesFilter(entry.summary, filter)).map(entry => ({ ...entry.summary, entry })), sort).map(item => item.entry), [entries, query, participants, equipment, duration, sort]);
  const filtering = Boolean(query || participants || equipment || duration);
  const clearFilters = () => { setQuery(''); setParticipants(''); setEquipment(''); setDuration(''); };
  const previewSummary = useMemo(() => preview && summariseWorkout(preview), [preview]);
  const conflict = preview && entries.find(entry => entry.workout.id === preview.id);

  async function importFile(file?: File) {
    if (!file) return;
    try {
      if (file.size > 1_048_576) throw new Error('Choose a workout file smaller than 1 MB.');
      const parsed = parseWorkoutFile(await file.text());
      summariseWorkout(parsed); // Compiles: unsupported or unbounded content is rejected before anything is saved.
      setPreview(parsed); setImportError('');
    } catch (error) { setPreview(undefined); setImportError(error instanceof Error ? error.message : 'This file could not be read.'); }
    importDialog.current?.showModal();
    if (fileInput.current) fileInput.current.value = '';
  }
  function confirmImport(mode: 'copy' | 'replace') {
    if (preview) onImport(preview, mode);
    importDialog.current?.close();
    setPreview(undefined);
  }

  return <div className={styles.library}>
    <div className={styles.heading}>
      <div>
        <div className={shared.eyebrow}>YOUR LIBRARY <span>/</span> {entries.length} {entries.length === 1 ? 'WORKOUT' : 'WORKOUTS'}</div>
        <h1>Pick your next session</h1>
        <p className={shared.description}>Bundled circuits and the WODs you’ve imported, all on this device. Filter, then press Start.</p>
      </div>
      <div className={styles.headingActions}>
        <button className={shared.primaryButton} onClick={() => fileInput.current?.click()}><Icon name="upload" size={18} />Import WOD</button>
        <input ref={fileInput} hidden type="file" accept=".json,.wod.json,application/json" onChange={event => void importFile(event.target.files?.[0])} />
      </div>
    </div>

    {missingId && <p className={shared.notice} role="status">No workout with the ID “{missingId}” is in this library. It may have been removed from this device.</p>}
    {storageError && <p className={shared.notice} role="alert">{storageError}</p>}

    <div className={styles.filters} role="search" aria-label="Filter workouts">
      <label className={styles.search}><Icon name="search" size={18} /><input type="search" placeholder="Search titles, movements, equipment" value={query} onChange={event => setQuery(event.target.value)} aria-label="Search workouts" /></label>
      <label>Athletes<select value={participants} onChange={event => setParticipants(event.target.value as '' | '1' | '2')}><option value="">Any</option><option value="1">Solo</option><option value="2">Pair</option></select></label>
      <label>Equipment<select value={equipment} onChange={event => setEquipment(event.target.value)}><option value="">Any</option>{equipmentList.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
      <label>Duration<select value={duration} onChange={event => setDuration(event.target.value as '' | DurationBucket)}><option value="">Any</option><option value="short">Up to 20 min</option><option value="medium">20 to 40 min</option><option value="long">Over 40 min</option></select></label>
      <label>Sort<select value={sort} onChange={event => setSort(event.target.value as LibrarySort)}><option value="title">Title</option><option value="shortest">Shortest first</option><option value="longest">Longest first</option></select></label>
    </div>
    <div className={styles.resultLine} aria-live="polite"><span>{visible.length === entries.length ? `${entries.length} ${entries.length === 1 ? 'workout' : 'workouts'}` : `${visible.length} of ${entries.length} workouts`}</span>{filtering && <button className={shared.quietButton} onClick={clearFilters}><Icon name="close" size={15} />Clear filters</button>}</div>

    {visible.length === 0 ? <div className={styles.empty}><h2>Nothing matches yet</h2><p>Try a broader search, or import a .wod.json file.</p></div> : <ul className={styles.grid} aria-label="Workouts">
      {visible.map(({ workout, summary, source }) => <li key={workout.id} className={styles.card} data-source={source}>
        <div className={styles.cardTop}><span className={styles.badge} data-kind={summary.participants === 2 ? 'pair' : 'solo'}><Icon name={summary.participants === 2 ? 'users' : 'user'} size={14} />{summary.participants === 2 ? 'Pair' : 'Solo'}</span><span className={styles.source}>{source === 'bundled' ? 'Bundled' : 'Saved on this device'}</span></div>
        <h2><a href={workoutHref(workout.id)}>{summary.title}</a></h2>
        {summary.description && <p className={styles.cardDescription}>{summary.description}</p>}
        <dl className={styles.facts}>
          <div><dt>Total</dt><dd>{displayTime(summary.totalMs)}</dd></div>
          <div><dt>Sections</dt><dd>{summary.sections}</dd></div>
          <div><dt>Movements</dt><dd>{summary.movements.length}</dd></div>
        </dl>
        {summary.equipment.length > 0 && <div className={styles.tags}>{summary.equipment.map(item => <button type="button" key={item} className={styles.tag} aria-pressed={equipment === item} onClick={() => setEquipment(value => value === item ? '' : item)}>{item}</button>)}</div>}
        <div className={styles.cardActions}>
          <a className={shared.primaryButton} href={workoutHref(workout.id)} aria-label={`Start ${summary.title}`}><Icon name="play" size={18} />Start</a>
          <button className={shared.quietButton} onClick={() => exportWorkoutFile(workout)} aria-label={`Export ${summary.title}`}><Icon name="download" size={17} />Export</button>
          {source === 'saved' && <button className={shared.quietButton} onClick={() => { setRemoving({ workout, summary, source }); removeDialog.current?.showModal(); }} aria-label={`Remove ${summary.title}`}><Icon name="trash" size={17} />Remove</button>}
        </div>
      </li>)}
    </ul>}

    <dialog ref={importDialog} className={shared.dialog} aria-labelledby="import-title"><div className={shared.dialogHeading}><h2 id="import-title">Preview your WOD</h2><button className={shared.iconButton} aria-label="Close import preview" onClick={() => importDialog.current?.close()}><Icon name="close" /></button></div>
      {importError ? <p role="alert" className={shared.importError}>{importError}</p> : preview && previewSummary && <>
        <h3>{preview.title}</h3>
        {preview.description && <p>{preview.description}</p>}
        <p>{displayTime(previewSummary.totalMs)} incl. prep · {preview.participants === 2 ? '2 athletes' : 'Solo'} · {previewSummary.sections} {previewSummary.sections === 1 ? 'section' : 'sections'} · {previewSummary.movements.length} movements</p>
        {preview.equipment.length > 0 && <p>{preview.equipment.join(' + ')}</p>}
        {conflict ? <p className={shared.notice} role="status">{conflict.source === 'bundled' ? `“${conflict.summary.title}” is a bundled workout with the same ID. The import is saved as a separate copy.` : `“${conflict.summary.title}” is already saved with this ID. Import another copy, or replace the saved one.`}</p> : <p className={shared.dialogIntro}>Saved to this device’s library. Starting is a separate step.</p>}
        <div className={shared.dialogActions}>
          {conflict?.source === 'saved' && <button className={shared.quietButton} onClick={() => confirmImport('replace')}>Replace saved copy</button>}
          <button className={shared.primaryButton} onClick={() => confirmImport('copy')}>{conflict ? 'Import as copy' : 'Save to library'}<Icon name="arrow" /></button>
        </div>
      </>}
    </dialog>

    <dialog ref={removeDialog} className={shared.dialog} aria-labelledby="remove-title"><h2 id="remove-title">Remove “{removing?.summary.title}”?</h2><p>It disappears from this device. Export it first if you want to keep a copy.</p><div className={shared.dialogActions}><button className={shared.quietButton} onClick={() => removeDialog.current?.close()}>Keep it</button><button className={shared.primaryButton} onClick={() => { if (removing) onRemove(removing.workout.id); removeDialog.current?.close(); setRemoving(undefined); }}>Remove workout</button></div></dialog>
  </div>;
}
