import { useEffect, useMemo, useRef, useState } from 'react';
import { MAX_FILE_BYTES, parseWorkoutFile, type Workout } from '../../../packages/domain/src';
import { equipmentOptions, matchesFilter, searchFields, sortSummaries, summariseWorkout, type DurationBucket, type LibraryFilter, type LibrarySort, type SummaryOptions, type WorkoutSummary } from '../../../packages/domain/src/library';
import { DIFFICULTY_LABELS, type DifficultyLevel } from '../../../packages/domain/src/difficulty';
import { FORMAT_LABELS, SECTION_FORMATS, type SectionFormat } from '../../../packages/domain/src/schema';
import type { Preferences } from './preferences';
import { collectionOf, type Collection } from './master-data';
import { agoText, lastDone, timesDone, type SessionRecord } from './session-log';
import { DifficultyChip } from './DifficultyChip';
import { AthletesChip, Chip, FormatChips } from './Chip';
import { displayTime } from '../../../packages/engine/src';
import { rankBySearch } from '../../../packages/domain/src/search';
import { draftHref, editHref, NEW_HREF, playHref, settingsHref, workoutHref } from './router';
import { workoutToBuilder } from '../../../packages/domain/src/builder';
import { NEW_DRAFT_ID, type StoredDraft } from './library-store';
import { Icon } from './Icon';
import { ConfirmDialog } from './ConfirmDialog';
import styles from './Library.module.css';
import shared from './App.module.css';

export interface LibraryEntry { workout: Workout; summary: WorkoutSummary; source: 'bundled' | 'saved'; editable: boolean }

export function toEntry(workout: Workout, source: LibraryEntry['source'], options: SummaryOptions = {}): LibraryEntry {
  return { workout, summary: summariseWorkout(workout, options), source, editable: workoutToBuilder(workout) !== null };
}

interface LibraryProps {
  entries: LibraryEntry[];
  collections: Collection[];
  sessions: SessionRecord[];
  onImport: (workout: Workout, mode: 'copy' | 'replace') => void;
  /** Editable files open in the editor as an unsaved draft; the preview dialog stays for structures the editor cannot express. */
  onImportDraft: (workout: Workout, fileName: string) => void;
  storageError: string;
  missingId?: string;
  drafts: StoredDraft[];
  onDiscardDraft: (id: string) => void;
  preferences: Preferences;
  onPreferencesChange: (update: (value: Preferences) => Preferences) => void;
}

type Sort = LibrarySort | 'longestAgo';
const DURATIONS: [DurationBucket, string][] = [['short', 'Up to 20 min'], ['medium', '20 to 40 min'], ['long', 'Over 40 min']];
export const durationLabel = (summary: WorkoutSummary) => summary.durationKind === 'open' ? 'Open' : `${summary.durationKind === 'capped' ? '≤ ' : ''}${displayTime(summary.totalMs)}`;
const toggle = <T,>(list: T[], item: T) => list.includes(item) ? list.filter(value => value !== item) : [...list, item];

/** Filters and sort survive navigation within the browser session; every read is validated. */
interface StoredFilters { query: string; participants: '' | 1 | 2; equipment: string[]; duration: DurationBucket[]; difficulty: DifficultyLevel[]; format: SectionFormat[]; collectionIds: string[]; sort: Sort }
const FILTER_KEY = 'openwod.libraryFilters';
const emptyFilters = (): StoredFilters => ({ query: '', participants: '', equipment: [], duration: [], difficulty: [], format: [], collectionIds: [], sort: 'title' });
function loadFilters(): StoredFilters {
  try {
    const stored = JSON.parse(sessionStorage.getItem(FILTER_KEY) ?? 'null') as Partial<StoredFilters> | null;
    if (!stored || typeof stored !== 'object') return emptyFilters();
    const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
    return {
      query: typeof stored.query === 'string' ? stored.query.slice(0, 200) : '',
      participants: stored.participants === 1 || stored.participants === 2 ? stored.participants : '',
      equipment: strings(stored.equipment), duration: strings(stored.duration).filter((item): item is DurationBucket => ['short', 'medium', 'long'].includes(item)),
      difficulty: Array.isArray(stored.difficulty) ? stored.difficulty.filter((item): item is DifficultyLevel => [1, 2, 3, 4].includes(item as number)) : [],
      format: strings(stored.format).filter((item): item is SectionFormat => (SECTION_FORMATS as readonly string[]).includes(item)),
      collectionIds: strings(stored.collectionIds),
      sort: typeof stored.sort === 'string' && ['title', 'shortest', 'longest', 'easiest', 'hardest', 'longestAgo'].includes(stored.sort) ? stored.sort as Sort : 'title',
    };
  } catch { return emptyFilters(); }
}

export function Library({ entries, collections, sessions, onImport, onImportDraft, storageError, missingId, drafts, onDiscardDraft, preferences, onPreferencesChange }: LibraryProps) {
  const [stored] = useState(loadFilters);
  const [query, setQuery] = useState(stored.query);
  const [participants, setParticipants] = useState<'' | 1 | 2>(stored.participants);
  const [equipment, setEquipment] = useState<string[]>(stored.equipment);
  const [duration, setDuration] = useState<DurationBucket[]>(stored.duration);
  const [difficulty, setDifficulty] = useState<DifficultyLevel[]>(stored.difficulty);
  const [format, setFormat] = useState<SectionFormat[]>(stored.format);
  const [collectionIds, setCollectionIds] = useState<string[]>(stored.collectionIds);
  const [sort, setSort] = useState<Sort>(stored.sort);
  useEffect(() => { try { sessionStorage.setItem(FILTER_KEY, JSON.stringify({ query, participants, equipment, duration, difficulty, format, collectionIds, sort } satisfies StoredFilters)); } catch { /* Session storage is a convenience only. */ } }, [query, participants, equipment, duration, difficulty, format, collectionIds, sort]);
  const [preview, setPreview] = useState<Workout>();
  const [importError, setImportError] = useState('');
  const [discarding, setDiscarding] = useState<StoredDraft>();
  const importDialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const onlyMine = preferences.onlyMyEquipment;
  const setOnlyMine = (value: boolean) => onPreferencesChange(current => ({ ...current, onlyMyEquipment: value }));

  const equipmentList = useMemo(() => equipmentOptions(entries.map(entry => entry.summary)), [entries]);
  const filter: LibraryFilter = { query, participants: participants || undefined, equipment, duration, difficulty, format, collections: collectionIds, onlyEquipment: onlyMine ? preferences.myEquipment : undefined };
  const visible = useMemo(() => {
    const matching = entries.filter(entry => matchesFilter(entry.summary, filter)).map(entry => ({ ...entry.summary, entry }));
    // Never done first (alphabetically), then the longest-ago session first.
    const stamp = (id: string) => lastDone(sessions, id)?.finishedAt ?? '';
    const sorted = sort !== 'longestAgo' ? sortSummaries(matching, sort) : [...matching].sort((a, b) => (stamp(a.id) === stamp(b.id) ? a.title.localeCompare(b.title, 'en') : stamp(a.id).localeCompare(stamp(b.id))));
    // With a query the best match comes first; the chosen sort breaks ties.
    return rankBySearch(sorted, query, item => searchFields(item)).map(item => item.entry);
  }, [entries, query, participants, equipment, duration, difficulty, format, collectionIds, onlyMine, preferences.myEquipment, sort, sessions]);
  const filtering = Boolean(query || participants || equipment.length || duration.length || difficulty.length || format.length || collectionIds.length || onlyMine);
  const clearFilters = () => { setQuery(''); setParticipants(''); setEquipment([]); setDuration([]); setDifficulty([]); setFormat([]); setCollectionIds([]); setOnlyMine(false); };
  const previewSummary = useMemo(() => preview && summariseWorkout(preview, { difficulty: preferences.difficulty }), [preview, preferences.difficulty]);
  const conflict = preview && entries.find(entry => entry.workout.id === preview.id);

  async function importFile(file?: File) {
    if (!file) return;
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error('Choose a workout file smaller than 1 MB.');
      const parsed = parseWorkoutFile(await file.text());
      summariseWorkout(parsed); // Compiles: unsupported or unbounded content is rejected before anything is saved.
      if (workoutToBuilder(parsed)) { if (fileInput.current) fileInput.current.value = ''; onImportDraft(parsed, file.name); return; }
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

  const group = (label: string, children: React.ReactNode) => <div className={styles.filterGroup} role="group" aria-label={label}><span className={styles.filterLabel}>{label}</span><div className={styles.chipRow}>{children}</div></div>;

  return <div className={styles.library}>
    <div className={styles.heading}>
      <div>
        <div className={shared.eyebrow}>YOUR LIBRARY <span>/</span> {entries.length} {entries.length === 1 ? 'WORKOUT' : 'WORKOUTS'}</div>
        <h1>Pick your next session</h1>
        <p className={shared.description}>Benchmarks, coach programming and the WODs you’ve built or imported, all on this device. Filter, then press Start.</p>
      </div>
      <div className={styles.headingActions}>
        <a className={shared.primaryButton} href={NEW_HREF}><Icon name="arrow" size={18} />New workout</a>
        <button className={shared.quietButton} onClick={() => fileInput.current?.click()}><Icon name="upload" size={18} />Import WOD</button>
        <input ref={fileInput} hidden type="file" accept=".yaml,.yml,.json,.wod.yaml,.wod.json,application/yaml,application/x-yaml,text/yaml,application/json" onChange={event => void importFile(event.target.files?.[0])} />
      </div>
    </div>

    {drafts.length > 0 && <section className={styles.drafts} aria-label="Drafts"><h2>Drafts</h2><ul>{drafts.map(draft => <li key={draft.id}><div><strong>{draft.draft.title.trim() || 'Untitled workout'}</strong><small>{draft.mode === 'replace' ? `Edits to “${entries.find(entry => entry.workout.id === draft.id)?.summary.title ?? draft.id}”` : draft.importedFrom ? `Imported from ${draft.importedFrom}, not saved yet` : 'New workout'} · saved {new Date(draft.updatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</small></div><div className={styles.draftActions}><a className={shared.primaryButton} href={draft.id === NEW_DRAFT_ID ? NEW_HREF : draft.importedFrom ? draftHref(draft.id) : editHref(draft.id)}>Continue editing</a><button className={shared.quietButton} onClick={() => setDiscarding(draft)} aria-label={`Discard draft ${draft.draft.title.trim() || 'Untitled workout'}`}><Icon name="trash" size={16} />Discard</button></div></li>)}</ul></section>}
    {missingId && <p className={shared.notice} role="status">No workout with the ID “{missingId}” is in this library. It may have been removed from this device.</p>}
    {storageError && <p className={shared.notice} role="alert">{storageError}</p>}

    <div className={styles.filters} role="search" aria-label="Filter workouts">
      <div className={styles.filterTop}>
        <label className={styles.search}><Icon name="search" size={18} /><input type="search" placeholder="Search titles, movements, equipment (typos welcome)" value={query} onChange={event => setQuery(event.target.value)} aria-label="Search workouts" /></label>
        <label className={styles.sort}>Sort<select value={sort} onChange={event => setSort(event.target.value as Sort)}><option value="title">Title</option><option value="shortest">Shortest first</option><option value="longest">Longest first</option><option value="easiest">Easiest first</option><option value="hardest">Hardest first</option><option value="longestAgo">Not done for longest</option></select></label>
      </div>
      {group('Athletes', <>{([[1, 'Solo'], [2, 'Pair']] as const).map(([value, label]) => <Chip key={value} kind={value === 2 ? 'pair' : 'solo'} icon={value === 2 ? 'users' : 'user'} pressed={participants === value} onClick={() => setParticipants(current => current === value ? '' : value)}>{label}</Chip>)}</>)}
      {group('Format', SECTION_FORMATS.map(item => <Chip key={item} kind="format" pressed={format.includes(item)} onClick={() => setFormat(current => toggle(current, item))}>{FORMAT_LABELS[item]}</Chip>))}
      {group('Collection', collections.map(collection => <Chip key={collection.id} kind="collection" pressed={collectionIds.includes(collection.id)} onClick={() => setCollectionIds(current => toggle(current, collection.id))}>{collection.title}</Chip>))}
      {group('Duration', DURATIONS.map(([value, label]) => <Chip key={value} kind="neutral" pressed={duration.includes(value)} onClick={() => setDuration(current => toggle(current, value))}>{label}</Chip>))}
      {group('Difficulty', ([1, 2, 3, 4] as const).map(level => <Chip key={level} kind="neutral" pressed={difficulty.includes(level)} onClick={() => setDifficulty(current => toggle(current, level))}>{DIFFICULTY_LABELS[level]}</Chip>))}
      {group('Equipment', <>
        <Chip kind="neutral" icon={onlyMine ? 'check' : undefined} pressed={onlyMine} title="Only workouts that need nothing beyond the gear ticked in settings" onClick={() => setOnlyMine(!onlyMine)}>Only my equipment</Chip>
        {equipmentList.map(item => <Chip key={item} kind="neutral" pressed={equipment.includes(item)} onClick={() => setEquipment(current => toggle(current, item))}>{item}</Chip>)}
      </>)}
    </div>
    <div className={styles.resultLine} aria-live="polite"><span>{visible.length === entries.length ? `${entries.length} ${entries.length === 1 ? 'workout' : 'workouts'}` : `${visible.length} of ${entries.length} workouts`}{onlyMine && preferences.myEquipment.length === 0 && <> · bodyweight only, <a href={settingsHref('equipment')}>tick your gear in settings</a></>}</span>{filtering && <button className={shared.quietButton} onClick={clearFilters}><Icon name="close" size={15} />Clear filters</button>}</div>

    {visible.length === 0 ? <div className={styles.empty}><h2>Nothing matches yet</h2><p>Try a broader search, or import a .wod.yaml file.</p></div> : <ul className={styles.grid} aria-label="Workouts">
      {visible.map(({ workout, summary, source }) => {
        const last = lastDone(sessions, workout.id);
        const count = timesDone(sessions, workout.id);
        return <li key={workout.id} className={styles.card} data-source={source} data-ripple data-tilt>
          <div className={styles.cardTop}><span className={styles.badges}><AthletesChip participants={summary.participants} /><FormatChips formats={summary.formats} /><DifficultyChip difficulty={summary.difficulty} /></span>{collectionOf(collections, workout.id) && <span className={styles.cardCollection} title="Collection">{collectionOf(collections, workout.id)!.title}</span>}</div>
          <h2><a href={workoutHref(workout.id)}>{summary.title}</a></h2>
          {summary.description && <p className={styles.cardDescription}>{summary.description}</p>}
          <dl className={styles.facts}>
            <div><dt>Total</dt><dd>{durationLabel(summary)}</dd></div>
            <div><dt>Sections</dt><dd>{summary.sections}</dd></div>
            <div><dt>Movements</dt><dd>{summary.movements.length}</dd></div>
          </dl>
          <div className={styles.tags}>
            {last ? <Chip kind="done" icon="check" title={new Date(last.finishedAt).toLocaleString()}>{count === 1 ? 'Done once' : `Done ${count}×`} · {agoText(last.finishedAt)}</Chip> : <Chip kind="neutral">Not done yet</Chip>}
            {summary.equipmentNeeded.length > 0 ? summary.equipmentNeeded.map(item => <button type="button" key={item} className={styles.tag} aria-pressed={equipment.includes(item)} onClick={() => setEquipment(current => toggle(current, item))}>{item}</button>) : <span className={styles.tag} data-plain>Bodyweight only</span>}
          </div>
          <div className={styles.cardActions}>
            <a className={shared.primaryButton} href={playHref(workout.id)} aria-label={`Start ${summary.title}`}><Icon name="play" size={18} />Start</a>
            <a className={shared.quietButton} href={workoutHref(workout.id)} aria-label={`Details of ${summary.title}`}><Icon name="list" size={17} />Details</a>
          </div>
        </li>;
      })}
    </ul>}

    <dialog ref={importDialog} className={shared.dialog} aria-labelledby="import-title"><div className={shared.dialogHeading}><h2 id="import-title">Preview your WOD</h2><button className={shared.iconButton} aria-label="Close import preview" onClick={() => importDialog.current?.close()}><Icon name="close" /></button></div>
      {importError ? <p role="alert" className={shared.importError}>{importError}</p> : preview && previewSummary && <>
        <h3>{preview.title}</h3>
        {preview.description && <p>{preview.description}</p>}
        <p>{durationLabel(previewSummary)} incl. prep · {preview.participants === 2 ? '2 athletes' : 'Solo'} · {previewSummary.formats.map(item => FORMAT_LABELS[item]).join(', ')} · {previewSummary.sections} {previewSummary.sections === 1 ? 'section' : 'sections'} · {previewSummary.movements.length} movements · projected {previewSummary.difficulty.label.toLowerCase()}</p>
        {previewSummary.equipmentNeeded.length > 0 && <p>{previewSummary.equipmentNeeded.join(' + ')}</p>}
        {conflict ? <p className={shared.notice} role="status">{conflict.source === 'bundled' ? `“${conflict.summary.title}” is a bundled workout with the same ID. The import is saved as a separate copy.` : `“${conflict.summary.title}” is already saved with this ID. Import another copy, or replace the saved one.`}</p> : <p className={shared.dialogIntro}>Saved to this device’s library. Starting is a separate step.</p>}
        <div className={shared.dialogActions}>
          {conflict?.source === 'saved' && <button className={shared.quietButton} onClick={() => confirmImport('replace')}>Replace saved copy</button>}
          <button className={shared.primaryButton} onClick={() => confirmImport('copy')}>{conflict ? 'Import as copy' : 'Save to library'}<Icon name="arrow" /></button>
        </div>
      </>}
    </dialog>

    <ConfirmDialog open={Boolean(discarding)} title={`Discard “${discarding?.draft.title.trim() || 'Untitled workout'}”?`} confirmLabel="Discard draft" cancelLabel="Keep it" onClose={() => setDiscarding(undefined)} onConfirm={() => { if (discarding) onDiscardDraft(discarding.id); setDiscarding(undefined); }}><p>The draft is removed from this device. Saved workouts are not affected.</p></ConfirmDialog>
  </div>;
}
