import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { type Workout } from '../../../packages/domain/src';
import { MAX_PACK_BYTES, parseSharedFile, type PackCollection, type SharedFile } from '../../../packages/domain/src/pack';
import type { PackDecision } from './data/remote';
import { ImportPreview } from './ImportPreview';
import { equipmentOptions, matchesFilter, searchFields, sortSummaries, summariseWorkout, type DurationBucket, type LibraryFilter, type LibrarySort, type SummaryOptions, type WorkoutSummary } from '../../../packages/domain/src/library';
import { DIFFICULTY_LABELS, type DifficultyLevel } from '../../../packages/domain/src/difficulty';
import { FORMAT_LABELS, SECTION_FORMATS, type SectionFormat } from '../../../packages/domain/src/schema';
import type { Preferences } from './preferences';
import { collectionOf, type Collection } from './master-data';
import { agoText, lastDone, timesDone } from './session-log';
import type { Connection, LegacyData, SessionView } from './data/use-library-data';
import type { DataMode } from './data/mode';
import type { OutboxItem } from './data/outbox';
import { elapsedText, type Recovery } from './data/checkpoints';
import { DifficultyChip } from './DifficultyChip';
import { AthletesChip, Chip, FormatChips } from './Chip';
import { displayTime } from '../../../packages/engine/src';
import { rankBySearch } from '../../../packages/domain/src/search';
import { draftHref, editHref, NEW_HREF, playHref, settingsHref, workoutHref } from './router';
import { workoutToBuilder } from '../../../packages/domain/src/builder';
import { freeWorkoutId, NEW_DRAFT_ID, type StoredDraft } from './library-store';
import { Icon } from './Icon';
import { ConfirmDialog } from './ConfirmDialog';
import styles from './Library.module.css';
import shared from './App.module.css';

export interface LibraryEntry { workout: Workout; summary: WorkoutSummary; source: 'bundled' | 'saved'; editable: boolean; /** Saved on this device, not yet on the household server. */ pending?: boolean; origin?: 'local' | 'imported' }

export function toEntry(workout: Workout, source: LibraryEntry['source'], options: SummaryOptions = {}): LibraryEntry {
  return { workout, summary: summariseWorkout(workout, options), source, editable: workoutToBuilder(workout) !== null };
}

interface LibraryProps {
  /** The static shape has no server: no reachability or legacy banners, and its own conflict wording. */
  mode: DataMode;
  entries: LibraryEntry[];
  collections: Collection[];
  sessions: SessionView[];
  /** Applies the decisions of the import preview (SHR-04) and, for a single workout, navigates to it. */
  onImportPack: (workouts: Workout[], collections: PackCollection[], decisions: Record<string, PackDecision>) => Promise<void>;
  /** A single editable file can open in the editor as an unsaved draft instead. */
  onImportDraft: (workout: Workout, fileName: string) => void;
  onExportLibrary: () => void;
  notice: string;
  onClearNotice: () => void;
  missingId?: string;
  connection: Connection;
  legacy?: LegacyData;
  migrating: boolean;
  onMigrate: () => Promise<unknown>;
  conflicts: OutboxItem[];
  rejected: OutboxItem[];
  onResolveConflict: (item: OutboxItem, decision: 'copy' | 'discard', freeId?: string) => Promise<void>;
  onDismissRejected: (item: OutboxItem) => Promise<void>;
  recoveries: Recovery[];
  onDiscardRecovery: (sessionId: string) => Promise<void>;
  drafts: StoredDraft[];
  onDiscardDraft: (id: string) => void;
  preferences: Preferences;
  onPreferencesChange: (update: (value: Preferences) => Preferences) => void;
}

type Sort = LibrarySort | 'longestAgo' | 'random';
const DURATIONS: [DurationBucket, string][] = [['short', 'Up to 20 min'], ['medium', '20 to 40 min'], ['long', 'Over 40 min']];
/** The timed content without the prep countdown: a tile says what the workout is, the overview adds the prep. */
export const durationLabel = (summary: WorkoutSummary) => summary.durationKind === 'open' ? 'Open' : `${summary.durationKind === 'capped' ? '≤ ' : ''}${displayTime(summary.activeMs)}`;
const toggle = <T,>(list: T[], item: T) => list.includes(item) ? list.filter(value => value !== item) : [...list, item];

/** A seeded Fisher–Yates shuffle stays stable across renders and library navigation. */
function shuffled<T>(items: T[], seed: number): T[] {
  const result = [...items];
  let state = seed >>> 0;
  for (let index = result.length - 1; index > 0; index--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const other = Math.floor(state / 0x1_0000_0000 * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

/** Filters and sort survive navigation within the browser session; every read is validated. */
interface StoredFilters { query: string; participants: '' | 1 | 2; equipment: string[]; duration: DurationBucket[]; difficulty: DifficultyLevel[]; format: SectionFormat[]; collectionIds: string[]; sort: Sort; randomSeed: number }
const FILTER_KEY = 'openwod.libraryFilters';
const emptyFilters = (): StoredFilters => ({ query: '', participants: '', equipment: [], duration: [], difficulty: [], format: [], collectionIds: [], sort: 'title', randomSeed: 0 });
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
      sort: typeof stored.sort === 'string' && ['title', 'shortest', 'longest', 'easiest', 'hardest', 'longestAgo', 'random'].includes(stored.sort) ? stored.sort as Sort : 'title',
      randomSeed: Number.isInteger(stored.randomSeed) && stored.randomSeed! >= 0 && stored.randomSeed! <= 0xffff_ffff ? stored.randomSeed! : 0,
    };
  } catch { return emptyFilters(); }
}

/** Pinboard packing for the workout grid: each card spans as many 8 px grid rows as its own height needs (plus the 16 px gap below it). */
function useMasonry(grid: RefObject<HTMLUListElement | null>) {
  useLayoutEffect(() => {
    const list = grid.current;
    if (!list || typeof ResizeObserver === 'undefined') return;
    const fit = (item: Element) => { (item as HTMLElement).style.gridRowEnd = `span ${Math.max(1, Math.ceil(((item as HTMLElement).offsetHeight + 16) / 8))}`; };
    // Spans are written in the next frame: writing them inside the observer callback reflows the grid mid-cycle and the browser reports an observer loop.
    const dirty = new Set<Element>();
    let frame = 0;
    const flush = () => { frame = 0; for (const item of dirty) fit(item); dirty.clear(); };
    const sizes = new ResizeObserver(entries => { for (const entry of entries) dirty.add(entry.target); frame ||= requestAnimationFrame(flush); });
    const watch = () => { sizes.disconnect(); for (const item of list.children) { fit(item); sizes.observe(item); } };
    watch();
    const children = new MutationObserver(watch);
    children.observe(list, { childList: true });
    return () => { sizes.disconnect(); children.disconnect(); if (frame) cancelAnimationFrame(frame); };
  });
}

export function Library({ mode, entries, collections, sessions, onImportPack, onImportDraft, onExportLibrary, notice, onClearNotice, missingId, drafts, onDiscardDraft, preferences, onPreferencesChange, connection, legacy, migrating, onMigrate, conflicts, rejected, onResolveConflict, onDismissRejected, recoveries, onDiscardRecovery }: LibraryProps) {
  const [migrationHidden, setMigrationHidden] = useState(false);
  const grid = useRef<HTMLUListElement>(null);
  useMasonry(grid);
  const [migrationReport, setMigrationReport] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [stored] = useState(loadFilters);
  const [query, setQuery] = useState(stored.query);
  const [participants, setParticipants] = useState<'' | 1 | 2>(stored.participants);
  const [equipment, setEquipment] = useState<string[]>(stored.equipment);
  const [duration, setDuration] = useState<DurationBucket[]>(stored.duration);
  const [difficulty, setDifficulty] = useState<DifficultyLevel[]>(stored.difficulty);
  const [format, setFormat] = useState<SectionFormat[]>(stored.format);
  const [collectionIds, setCollectionIds] = useState<string[]>(stored.collectionIds);
  const [sort, setSort] = useState<Sort>(stored.sort);
  const [randomSeed, setRandomSeed] = useState(stored.randomSeed);
  useEffect(() => { try { sessionStorage.setItem(FILTER_KEY, JSON.stringify({ query, participants, equipment, duration, difficulty, format, collectionIds, sort, randomSeed } satisfies StoredFilters)); } catch { /* Session storage is a convenience only. */ } }, [query, participants, equipment, duration, difficulty, format, collectionIds, sort, randomSeed]);
  const [preview, setPreview] = useState<{ file: SharedFile; name: string }>();
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
    const sorted = sort === 'random' ? matching : sort !== 'longestAgo' ? sortSummaries(matching, sort) : [...matching].sort((a, b) => (stamp(a.id) === stamp(b.id) ? a.title.localeCompare(b.title, 'en') : stamp(a.id).localeCompare(stamp(b.id))));
    // With a query the best match comes first; the chosen sort breaks ties.
    const ranked = rankBySearch(sorted, query, item => searchFields(item)).map(item => item.entry);
    return sort === 'random' ? shuffled(ranked, randomSeed) : ranked;
  }, [entries, query, participants, equipment, duration, difficulty, format, collectionIds, onlyMine, preferences.myEquipment, sort, sessions, randomSeed]);
  const randomise = () => { setRandomSeed(Math.floor(Math.random() * 0x1_0000_0000)); setSort('random'); };
  const activeFilters = (participants ? 1 : 0) + equipment.length + duration.length + difficulty.length + format.length + collectionIds.length + (onlyMine ? 1 : 0);
  const filtering = Boolean(query || participants || equipment.length || duration.length || difficulty.length || format.length || collectionIds.length || onlyMine);
  const clearFilters = () => { setQuery(''); setParticipants(''); setEquipment([]); setDuration([]); setDifficulty([]); setFormat([]); setCollectionIds([]); setOnlyMine(false); };

  async function importFile(file?: File) {
    if (!file) return;
    try {
      if (file.size > MAX_PACK_BYTES) throw new Error('Choose a workout file or pack smaller than 4 MB.');
      const parsed = parseSharedFile(await file.text());
      // Compiles every workout: unsupported or unbounded content is rejected before anything is saved.
      for (const workout of parsed.kind === 'pack' ? parsed.pack.workouts : [parsed.workout]) summariseWorkout(workout);
      setPreview({ file: parsed, name: file.name }); setImportError('');
    } catch (error) { setPreview(undefined); setImportError(error instanceof Error ? error.message : 'This file could not be read.'); }
    importDialog.current?.showModal();
    if (fileInput.current) fileInput.current.value = '';
  }
  const closeImport = () => { importDialog.current?.close(); setPreview(undefined); };

  const group = (label: string, children: React.ReactNode) => <div className={styles.filterGroup} role="group" aria-label={label}><span className={styles.filterLabel}>{label}</span><div className={styles.chipRow}>{children}</div></div>;

  return <div className={styles.library}>
    <div className={styles.heading}>
      <div>
        <div className={shared.eyebrow}>YOUR LIBRARY <span>/</span> {entries.length} {entries.length === 1 ? 'WORKOUT' : 'WORKOUTS'}</div>
        <h1>Pick your next session</h1>
        <p className={shared.description}>Benchmarks, advanced pieces and the WODs you’ve built or imported, {mode === 'server' ? 'shared by every device in the household' : 'all on this device'}. Filter, then press Start.</p>
      </div>
      <div className={styles.headingActions}>
        <a className={shared.primaryButton} href={NEW_HREF}><Icon name="arrow" size={18} />New workout</a>
        <button className={shared.quietButton} onClick={() => fileInput.current?.click()}><Icon name="upload" size={18} />Import WOD</button>
        {entries.some(entry => entry.source === 'saved') && <button className={shared.quietButton} onClick={onExportLibrary} title="Every saved workout and your collections as one .wods.yaml pack"><Icon name="download" size={18} />Export library</button>}
        <input ref={fileInput} hidden type="file" accept=".yaml,.yml,.json,.wod.yaml,.wod.json,application/yaml,application/x-yaml,text/yaml,application/json" onChange={event => void importFile(event.target.files?.[0])} />
      </div>
    </div>

    {drafts.length > 0 && <section className={styles.drafts} aria-label="Drafts"><h2>Drafts</h2><ul>{drafts.map(draft => <li key={draft.id}><div><strong>{draft.draft.title.trim() || 'Untitled workout'}</strong><small>{draft.mode === 'replace' ? `Edits to “${entries.find(entry => entry.workout.id === draft.id)?.summary.title ?? draft.id}”` : draft.importedFrom ? `Imported from ${draft.importedFrom}, not saved yet` : 'New workout'} · saved {new Date(draft.updatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</small></div><div className={styles.draftActions}><a className={shared.primaryButton} href={draft.id === NEW_DRAFT_ID ? NEW_HREF : draft.importedFrom ? draftHref(draft.id) : editHref(draft.id)}>Continue editing</a><button className={shared.quietButton} onClick={() => setDiscarding(draft)} aria-label={`Discard draft ${draft.draft.title.trim() || 'Untitled workout'}`}><Icon name="trash" size={16} />Discard</button></div></li>)}</ul></section>}
    {missingId && <p className={shared.notice} role="status">No workout with the ID “{missingId}” is in this library. It may have been removed from this device.</p>}
    {recoveries.map(({ checkpoint }) => <section key={checkpoint.sessionId} className={styles.banner} role="status" aria-label="Interrupted session"><div><strong>Interrupted session of “{checkpoint.workout.title}”</strong><p>Saved {elapsedText(Date.now() - new Date(checkpoint.savedAt).getTime())} on this device. Resume where it stopped, or discard it.</p></div><div className={styles.bannerActions}><a className={shared.primaryButton} href={playHref(checkpoint.workoutId)}><Icon name="play" size={16} />Resume</a><button type="button" className={shared.quietButton} onClick={() => void onDiscardRecovery(checkpoint.sessionId)}>Discard</button></div></section>)}
    {notice && <p className={shared.notice} role="alert">{notice} <button type="button" className={styles.linkButton} onClick={onClearNotice}>Dismiss</button></p>}
    {mode === 'server' && connection === 'unreachable' && <p className={shared.notice} role="status">The household server cannot be reached. The library shows what this device last saw; anything you save waits here and uploads when the server is back.</p>}
    {mode === 'server' && legacy && !migrationHidden && <section className={styles.banner} role="status" aria-label="Move device data">
      <div><strong>This device still holds data from before the household server.</strong><p>{[legacy.workouts.length ? `${legacy.workouts.length} saved ${legacy.workouts.length === 1 ? 'workout' : 'workouts'}` : '', legacy.sessions.length ? `${legacy.sessions.length} logged ${legacy.sessions.length === 1 ? 'session' : 'sessions'}` : '', 'your settings'].filter(Boolean).join(', ')}. Move them to the server so every device sees them; the browser copies are removed afterwards.</p></div>
      <div className={styles.bannerActions}><button type="button" className={shared.primaryButton} disabled={migrating || connection !== 'online'} onClick={() => { void onMigrate().then(report => { const summary = report as { workouts?: { created: number; renamed: { from: string; to: string }[] }; sessions?: { created: number } } | undefined; if (summary) setMigrationReport(`Moved ${summary.workouts?.created ?? 0} workouts and ${summary.sessions?.created ?? 0} sessions to the server${summary.workouts?.renamed.length ? ` (${summary.workouts.renamed.map(item => `${item.from} became ${item.to}`).join(', ')})` : ''}.`); }); }}><Icon name="upload" size={16} />{migrating ? 'Moving…' : 'Move to the server'}</button><button type="button" className={shared.quietButton} onClick={() => setMigrationHidden(true)}>Not now</button></div>
    </section>}
    {migrationReport && <p className={shared.notice} role="status">{migrationReport}</p>}
    {conflicts.map(item => { const workout = item.body as Workout; const taken = new Set(entries.map(entry => entry.workout.id)); return <p key={item.id} className={shared.notice} role="alert">“{workout.title}” could not be saved: {mode === 'static' ? <>another tab of this browser already saved revision {item.current?.revision ?? '?'} of it.</> : <>the household server already holds revision {item.current?.revision ?? '?'} of it, changed elsewhere.</>} <button type="button" className={styles.linkButton} onClick={() => void onResolveConflict(item, 'copy', freeWorkoutId(`${workout.id}-copy`, taken))}>Save mine as a copy</button> <button type="button" className={styles.linkButton} onClick={() => void onResolveConflict(item, 'discard')}>Discard mine</button></p>; })}
    {rejected.map(item => <p key={item.id} className={shared.notice} role="alert">{mode === 'static' ? `A change could not be saved and will not be retried: ${item.error ?? 'it is not valid'}.` : `A change could not be uploaded and will not be retried: ${item.error ?? 'the server refused it'}.`} <button type="button" className={styles.linkButton} onClick={() => void onDismissRejected(item)}>Dismiss</button></p>)}

    <div className={styles.filters} role="search" aria-label="Filter workouts" data-open={filtersOpen}>
      <div className={styles.filterTop}>
        <label className={styles.search}><Icon name="search" size={18} /><input type="search" placeholder="Search titles, movements, equipment (typos welcome)" value={query} onChange={event => setQuery(event.target.value)} aria-label="Search workouts" /></label>
        {/* On a phone the filter groups fold away behind this button, so the workouts start on the first screen. */}
        <button type="button" className={styles.filterToggle} aria-expanded={filtersOpen} aria-controls="library-filters" onClick={() => setFiltersOpen(open => !open)}><Icon name="filter" size={17} />Filters{activeFilters > 0 && <span className={styles.filterCount} aria-label={`${activeFilters} active`}>{activeFilters}</span>}</button>
        <div className={styles.sortControls}>
          <label className={styles.sort}>Sort<select value={sort} onChange={event => event.target.value === 'random' ? randomise() : setSort(event.target.value as Sort)}><option value="title">Title</option><option value="shortest">Shortest first</option><option value="longest">Longest first</option><option value="easiest">Easiest first</option><option value="hardest">Hardest first</option><option value="longestAgo">Not done for longest</option><option value="random">Random</option></select></label>
          <button type="button" className={styles.randomButton} aria-label="Shuffle workouts" title="Shuffle the filtered workouts" aria-pressed={sort === 'random'} disabled={visible.length < 2} onClick={randomise}><Icon name="dice" size={22} /></button>
        </div>
      </div>
      <div id="library-filters" className={styles.filterGroups}>
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
    </div>
    <div className={styles.resultLine} aria-live="polite"><span>{visible.length === entries.length ? `${entries.length} ${entries.length === 1 ? 'workout' : 'workouts'}` : `${visible.length} of ${entries.length} workouts`}{onlyMine && preferences.myEquipment.length === 0 && <> · bodyweight only, <a href={settingsHref('equipment')}>tick your gear in settings</a></>}</span>{filtering && <button className={shared.quietButton} onClick={clearFilters}><Icon name="close" size={15} />Clear filters</button>}</div>

    {visible.length === 0 ? <div className={styles.empty}><h2>Nothing matches yet</h2><p>Try a broader search, or import a .wod.yaml file.</p></div> : <ul ref={grid} className={styles.grid} aria-label="Workouts">
      {visible.map(({ workout, summary, source, pending }) => {
        const last = lastDone(sessions, workout.id);
        const count = timesDone(sessions, workout.id);
        // The whole tile opens the workout; its own links, buttons and a text selection keep their meaning.
        const open = (event: React.MouseEvent<HTMLLIElement>) => { if ((event.target as HTMLElement).closest('a, button') || window.getSelection()?.toString()) return; window.location.hash = workoutHref(workout.id).replace(/^#/, ''); };
        return <li key={workout.id} className={styles.card} data-source={source} data-ripple data-tilt onClick={open}>
          <div className={styles.cardTop}><span className={styles.badges}><AthletesChip participants={summary.participants} /><FormatChips formats={summary.formats} /><DifficultyChip difficulty={summary.difficulty} /></span></div>
          <div className={styles.titleRow}><h2><a href={workoutHref(workout.id)}>{summary.title}</a></h2>{collectionOf(collections, workout.id) && <span className={styles.cardCollection} title="Collection">{collectionOf(collections, workout.id)!.title}</span>}</div>
          {summary.description && <p className={styles.cardDescription}>{summary.description}</p>}
          <dl className={styles.facts}>
            <div><dt>Total</dt><dd>{durationLabel(summary)}</dd></div>
            <div><dt>Sections</dt><dd>{summary.sections}</dd></div>
            <div><dt>Movements</dt><dd>{summary.movements.length}</dd></div>
          </dl>
          <div className={styles.tags}>
            {pending && <Chip kind="neutral" icon="upload" title="Saved on this device; it reaches the household server when the server is back">Not yet on the server</Chip>}
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
      {importError ? <p role="alert" className={shared.importError}>{importError}</p> : preview && <ImportPreview key={preview.name + preview.file.kind} file={preview.file} fileName={preview.name} entries={entries} difficulty={preferences.difficulty}
        onOpenInEditor={preview.file.kind === 'workout' && workoutToBuilder(preview.file.workout) ? workout => { closeImport(); onImportDraft(workout, preview.name); } : undefined}
        onConfirm={async (workouts, packCollections, decisions) => { await onImportPack(workouts, packCollections, decisions); closeImport(); }} onClose={closeImport} />}
    </dialog>

    <ConfirmDialog open={Boolean(discarding)} title={`Discard “${discarding?.draft.title.trim() || 'Untitled workout'}”?`} confirmLabel="Discard draft" cancelLabel="Keep it" onClose={() => setDiscarding(undefined)} onConfirm={() => { if (discarding) onDiscardDraft(discarding.id); setDiscarding(undefined); }}><p>The draft is removed from this device. Saved workouts are not affected.</p></ConfirmDialog>
  </div>;
}
