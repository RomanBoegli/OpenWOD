import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Workout } from '../../../packages/domain/src';
import { fixtureWorkouts } from '../../../packages/domain/src/fixtures';
import { WorkoutAudio } from './audio';
import { Library, toEntry, type LibraryEntry } from './Library';
import { Player } from './Player';
import { Overview } from './Overview';
import { Editor } from './Editor';
import { Settings } from './Settings';
import { builderToWorkout, emptyDraft, workoutToBuilder, type BuilderDraft } from '../../../packages/domain/src/builder';
import { freeWorkoutId, loadDrafts, loadSavedWorkouts, NEW_DRAFT_ID, persistDrafts, persistSavedWorkouts, SAVED_LIMIT, slugify, type StoredDraft } from './library-store';
import { allCollections, canonicalEquipment, effectiveCatalogue, loadMasterData, persistMasterData, upsertMovement, type MasterData, type Movement } from './master-data';
import { linkDraft } from './catalogue-link';
import { loadSessions, persistSessions, SESSION_LIMIT, type SessionRecord } from './session-log';
import { loadPreferences, savePreferences } from './preferences';
import { draftHref, SETTINGS_HREF, useRoute, workoutHref } from './router';
import { useTheme } from './theme';
import { Icon } from './Icon';
import { BrandMark } from './BrandMark';
import { installFeel } from './feel';
import styles from './App.module.css';

export default function App() {
  const { route } = useRoute();
  const [preferences, setPreferences] = useState(loadPreferences);
  const [saved, setSaved] = useState(loadSavedWorkouts);
  const [drafts, setDrafts] = useState(loadDrafts);
  const [masterData, setMasterData] = useState(loadMasterData);
  const [sessions, setSessions] = useState(loadSessions);
  const [storageError, setStorageError] = useState('');
  const [performing, setPerforming] = useState(false);
  const [clipsReady, setClipsReady] = useState<boolean>();
  const [packs, setPacks] = useState<{ id: string; label: string }[]>([]);
  const audioRef = useRef<WorkoutAudio>(null);
  audioRef.current ??= new WorkoutAudio();
  const audio = audioRef.current;
  audio.mode = preferences.soundMode;
  audio.cueSource = preferences.cueSource;
  audio.onClips = setClipsReady;
  audio.onPacks = setPacks;
  audio.cuePack = preferences.cuePack;
  audio.rate = preferences.rate;
  audio.volume = preferences.volume;

  useTheme(preferences.theme);
  useEffect(() => savePreferences(preferences), [preferences]);
  useEffect(() => { void audio.listPacks(); }, [audio]);
  useEffect(() => installFeel(), []);
  useEffect(() => { if (route.name !== 'play') window.scrollTo(0, 0); }, [route]);

  const collections = useMemo(() => allCollections(masterData), [masterData]);
  const catalogue = useMemo(() => effectiveCatalogue(masterData), [masterData]);
  audio.resolveMovement = lane => catalogue.resolve(lane)?.id;
  const summaryOptions = useCallback((id: string) => ({ canonicalEquipment: canonicalEquipment(masterData.equipmentAliases), catalogue, collections: collections.filter(collection => collection.workoutIds.includes(id)).map(collection => collection.id) }), [masterData.equipmentAliases, catalogue, collections]);
  const bundledEntries = useMemo(() => fixtureWorkouts.map(workout => toEntry(workout, 'bundled', summaryOptions(workout.id))), [summaryOptions]);
  const savedEntries = useMemo(() => saved.map(workout => toEntry(workout, 'saved', summaryOptions(workout.id))), [saved, summaryOptions]);
  const entries = useMemo<LibraryEntry[]>(() => [...bundledEntries, ...savedEntries], [bundledEntries, savedEntries]);
  const updateSaved = useCallback((next: Workout[]) => { setSaved(next); setStorageError(persistSavedWorkouts(next) ?? ''); }, []);
  const updateMasterData = useCallback((change: (current: MasterData) => MasterData) => setMasterData(current => { const next = change(current); const error = persistMasterData(next); if (error) setStorageError(error); return next; }), []);
  const logSession = useCallback((record: SessionRecord) => setSessions(current => { const next = [record, ...current].slice(0, SESSION_LIMIT); const error = persistSessions(next); if (error) setStorageError(error); return next; }), []);
  const importWorkout = useCallback((workout: Workout, mode: 'copy' | 'replace') => {
    if (mode === 'replace') { updateSaved(saved.map(item => item.id === workout.id ? workout : item)); return; }
    if (saved.length >= SAVED_LIMIT) { setStorageError(`This device keeps up to ${SAVED_LIMIT} imported workouts. Remove one before importing another.`); return; }
    const id = freeWorkoutId(workout.id, new Set(entries.map(entry => entry.workout.id)));
    updateSaved([...saved, { ...workout, id }]);
  }, [saved, entries, updateSaved]);
  const removeWorkout = useCallback((id: string) => updateSaved(saved.filter(item => item.id !== id)), [saved, updateSaved]);
  const addMovement = useCallback((record: Movement) => updateMasterData(data => upsertMovement(data, record)), [updateMasterData]);
  // Draft updates are functional so autosave never depends on a stale list and never changes identity.
  const updateDrafts = useCallback((change: (current: StoredDraft[]) => StoredDraft[]) => setDrafts(current => { const next = change(current); const error = persistDrafts(next); if (error) setStorageError(error); return next; }), []);
  const discardDraft = useCallback((id: string) => updateDrafts(current => current.filter(draft => draft.id !== id)), [updateDrafts]);
  /** An imported file becomes an unsaved draft in the editor, its movements linked to the catalogue where names match. */
  const importDraft = useCallback((workout: Workout, fileName: string) => {
    const builder = workoutToBuilder(workout);
    if (!builder) return;
    const id = freeWorkoutId(`import-${slugify(workout.title)}`, new Set(drafts.map(draft => draft.id)));
    updateDrafts(current => [{ id, mode: 'create', draft: linkDraft(builder, catalogue), updatedAt: new Date().toISOString(), importedFrom: fileName }, ...current]);
    window.location.hash = draftHref(id);
  }, [drafts, catalogue, updateDrafts]);
  const autosaveDraft = useCallback((id: string, mode: StoredDraft['mode'], draft: BuilderDraft) => {
    updateDrafts(current => { const previous = current.find(item => item.id === id); return [{ id, mode, draft, updatedAt: new Date().toISOString(), ...(previous?.importedFrom ? { importedFrom: previous.importedFrom } : {}) }, ...current.filter(item => item.id !== id)]; });
  }, [updateDrafts]);
  /** Saving a draft: replace the saved workout at the next revision, or create a new saved workout with a free ID. */
  const saveDraft = useCallback((id: string, mode: StoredDraft['mode'], draft: BuilderDraft) => {
    const existing = mode === 'replace' ? saved.find(item => item.id === id) : undefined;
    if (existing) {
      updateSaved(saved.map(item => item.id === id ? builderToWorkout(linkDraft(draft, catalogue), { id, revision: existing.revision + 1 }) : item));
      updateDrafts(current => current.filter(item => item.id !== id));
      window.location.hash = workoutHref(id);
      return;
    }
    if (saved.length >= SAVED_LIMIT) { setStorageError(`This device keeps up to ${SAVED_LIMIT} saved workouts. Remove one before saving another.`); return; }
    const newId = freeWorkoutId(slugify(draft.title), new Set(entries.map(entry => entry.workout.id)));
    updateSaved([...saved, builderToWorkout(linkDraft(draft, catalogue), { id: newId, revision: 1 })]);
    updateDrafts(current => current.filter(item => item.id !== id));
    window.location.hash = workoutHref(newId);
  }, [saved, entries, catalogue, updateSaved, updateDrafts]);

  const current = route.name === 'library' || route.name === 'new' || route.name === 'settings' || route.name === 'draft' ? undefined : entries.find(entry => entry.workout.id === route.id);
  const importedDraft = route.name === 'draft' ? drafts.find(draft => draft.id === route.id) : undefined;
  // Editor inputs: a resumed draft wins; otherwise the workout itself, or a titled copy of a bundled one.
  const editing = route.name === 'new' ? { id: NEW_DRAFT_ID, mode: 'create' as const, initial: drafts.find(draft => draft.id === NEW_DRAFT_ID)?.draft ?? emptyDraft(2) }
    : importedDraft ? { id: importedDraft.id, mode: 'create' as const, initial: importedDraft.draft, importedFrom: importedDraft.importedFrom }
    : route.name === 'edit' && current ? (() => {
      const mode = current.source === 'saved' ? 'replace' as const : 'create' as const;
      const stored = drafts.find(draft => draft.id === current.workout.id);
      const fromWorkout = workoutToBuilder(current.workout);
      const initial = stored?.draft ?? (fromWorkout && mode === 'create' ? { ...fromWorkout, title: `Copy of ${fromWorkout.title}` } : fromWorkout);
      return initial ? { id: current.workout.id, mode, initial } : undefined;
    })() : undefined;
  const editingDraft = editing && drafts.find(draft => draft.id === editing.id);

  return <div className={styles.app} data-performing={performing}>
    <header className={styles.header}>
      <a href="#/" className={styles.brand} aria-label="OpenWOD library"><BrandMark className={styles.brandMark} /><span className={styles.wordmark}>Open<b>WOD</b></span></a>
      {current && (route.name === 'play' || route.name === 'edit') ? <a href={workoutHref(current.workout.id)} className={styles.backLink} aria-label="Back to workout overview"><Icon name="back" size={17} /><span>Overview</span></a> : current || route.name === 'new' || route.name === 'settings' || route.name === 'draft' ? <a href="#/" className={styles.backLink} aria-label="Back to library"><Icon name="back" size={17} /><span>Library</span></a> : <span className={styles.headerNote}>Not born. Made.</span>}
      <div className={styles.headerActions}>
        <button className={styles.quietButton} onClick={() => void audio.test()} disabled={preferences.soundMode === 'silent'}><Icon name="sound" /><span>Test sound</span></button>
        <a className={styles.iconButton} aria-label="Settings" href={SETTINGS_HREF}><Icon name="settings" /></a>
      </div>
    </header>

    <main className={styles.main}>
      {current && route.name === 'play' ? <Player key={current.workout.id} workout={current.workout} audio={audio} preferences={preferences} catalogue={catalogue} onPreferencesChange={setPreferences} onPerformingChange={setPerforming} onSessionEnd={logSession} />
        : route.name === 'settings' ? <Settings section={route.section} preferences={preferences} onPreferencesChange={setPreferences} masterData={masterData} onMasterDataChange={updateMasterData} catalogue={catalogue} entries={entries} clipsReady={clipsReady} packs={packs} audio={audio} />
        : editing ? <Editor key={`${editing.id}:${editing.mode}`} mode={editing.mode} initial={editing.initial} importedFrom={'importedFrom' in editing ? editing.importedFrom : undefined} catalogue={catalogue} onAddMovement={addMovement} savedAt={editingDraft?.updatedAt} onAutosave={draft => autosaveDraft(editing.id, editing.mode, draft)} onSave={draft => saveDraft(editing.id, editing.mode, draft)} onDiscard={() => { discardDraft(editing.id); window.location.hash = editing.mode === 'replace' ? workoutHref(editing.id) : '#/'; }} />
        : route.name === 'draft' ? <div className={styles.notice} role="status">That imported draft is no longer on this device. <a href="#/">Back to the library</a>.</div>
        : route.name === 'edit' && current ? <div className={styles.notice} role="status">“{current.summary.title}” uses a structure the editor cannot change yet. You can still export it or read through it. <a href={workoutHref(current.workout.id)}>Back to the overview</a>.</div>
        : current ? <Overview key={current.workout.id} entry={current} names={preferences.names} collections={collections.filter(collection => collection.workoutIds.includes(current.workout.id))} sessions={sessions.filter(session => session.workoutId === current.workout.id)} catalogue={catalogue} loadsFor={preferences.loadsFor} onRemove={removeWorkout} />
        : <Library entries={entries} collections={collections} sessions={sessions} onImport={importWorkout} onImportDraft={importDraft} onRemove={removeWorkout} storageError={storageError} missingId={route.name === 'library' ? undefined : (route as { id?: string }).id} drafts={drafts} onDiscardDraft={discardDraft} preferences={preferences} onPreferencesChange={setPreferences} />}
      <footer className={styles.footer}><span>NOT BORN. MADE.</span><span>Player preview · workouts run locally · <a href="/LICENSE" target="_blank" rel="noreferrer">GPLv3</a></span></footer>
    </main>
  </div>;
}
