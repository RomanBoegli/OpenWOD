import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Workout } from '../../../packages/domain/src';
import { bundledWorkouts } from '../../../packages/domain/src/bundled';
import { WorkoutAudio } from './audio';
import { Library, toEntry, type LibraryEntry } from './Library';
import { exportPackFile, exportWorkoutFile } from './Player';
import { ConfirmDialog } from './ConfirmDialog';
import type { PackCollection } from '../../../packages/domain/src/pack';
import type { PackDecision } from './data/remote';
import { Player } from './Player';
import { Overview } from './Overview';
import { Editor } from './Editor';
import { Settings } from './Settings';
import { History, SnapshotPlayer } from './History';
import { builderToWorkout, emptyDraft, workoutToBuilder, type BuilderDraft } from '../../../packages/domain/src/builder';
import { freeWorkoutId, loadDrafts, NEW_DRAFT_ID, persistDrafts, SAVED_LIMIT, slugify, type StoredDraft } from './library-store';
import { allCollections, canonicalEquipment, effectiveCatalogue, upsertMovement, type Movement } from './master-data';
import { linkDraft } from './catalogue-link';
import { loadPreferences, savePreferences } from './preferences';
import { draftHref, HISTORY_HREF, SETTINGS_HREF, useRoute, workoutHref } from './router';
import { useTheme } from './theme';
import { Icon } from './Icon';
import { BrandMark } from './BrandMark';
import { installFeel } from './feel';
import { useLibraryData, type SaveResult } from './data/use-library-data';
import { probeSessionLock, takeOverSession } from './data/session-lock';
import type { SessionRecord } from '../../../packages/engine/src/records';
import styles from './App.module.css';
import { newId } from './ids';

/** The deployment shape in the footer, with a one-line explainer on hover or focus. */
const SHAPE_LABELS = { server: 'Server', static: 'Static' } as const;
const SHAPE_TIPS = {
  server: 'Your household server keeps the library and the session log for every device.',
  static: 'No server: the library lives in this browser only. Download a backup in Settings.',
} as const;

export default function App() {
  const { route } = useRoute();
  const [preferences, setPreferences] = useState(loadPreferences);
  const [drafts, setDrafts] = useState(loadDrafts);
  const [storageError, setStorageError] = useState('');
  const [performing, setPerforming] = useState(false);
  const [clipsReady, setClipsReady] = useState<boolean>();
  const [packs, setPacks] = useState<{ id: string; label: string }[]>([]);
  const data = useLibraryData();
  const { saved, masterData, sessions, updateMasterData } = data;
  const recordSession = useCallback((record: SessionRecord) => { void data.recordSession(record).catch(() => undefined); }, [data]);
  const clearSession = useCallback((sessionId: string) => { void data.clearRecovery(sessionId); }, [data]);
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
  audio.beepVolume = preferences.beepVolume;
  audio.tone = preferences.beepTone;

  useTheme(preferences.theme, preferences.accent, preferences.restColor, preferences.background);
  useEffect(() => savePreferences(preferences), [preferences]);
  useEffect(() => { void audio.listPacks(); }, [audio]);
  useEffect(() => installFeel(), []);
  useEffect(() => { if (route.name !== 'play' && route.name !== 'historyPlay') window.scrollTo(0, 0); }, [route]);

  const collections = useMemo(() => allCollections(masterData), [masterData]);
  const catalogue = useMemo(() => effectiveCatalogue(masterData), [masterData]);
  audio.resolveMovement = lane => catalogue.resolve(lane)?.id;
  const summaryOptions = useCallback((id: string) => ({ canonicalEquipment: canonicalEquipment(masterData.equipmentAliases), catalogue, collections: collections.filter(collection => collection.workoutIds.includes(id)).map(collection => collection.id), difficulty: preferences.difficulty }), [masterData.equipmentAliases, catalogue, collections, preferences.difficulty]);
  const bundledEntries = useMemo(() => bundledWorkouts.map(workout => toEntry(workout, 'bundled', summaryOptions(workout.id))), [summaryOptions]);
  const savedEntries = useMemo(() => saved.map(item => ({ ...toEntry(item.document, 'saved', summaryOptions(item.id)), pending: data.pendingIds.has(item.id), origin: item.origin })), [saved, summaryOptions, data.pendingIds]);
  const entries = useMemo<LibraryEntry[]>(() => [...bundledEntries, ...savedEntries], [bundledEntries, savedEntries]);
  /** Applies an import preview's decisions on the server; a single imported workout opens its overview. */
  const importPack = useCallback(async (workouts: Workout[], packCollections: PackCollection[], decisions: Record<string, PackDecision>) => {
    const report = await data.importPack(workouts, packCollections, decisions);
    const summary = [report.created.length ? `${report.created.length} imported` : '', report.replaced.length ? `${report.replaced.length} replaced` : '', report.skipped ? `${report.skipped} skipped` : '', report.collections ? `${report.collections} ${report.collections === 1 ? 'collection' : 'collections'} created` : ''].filter(Boolean).join(', ');
    setStorageError('');
    if (workouts.length === 1 && (report.created[0] || report.replaced[0])) { window.location.hash = workoutHref(report.created[0]?.to ?? report.replaced[0]); return; }
    setImportReport(summary ? `Import done: ${summary}.` : 'Nothing was imported.');
  }, [data]);
  const [importReport, setImportReport] = useState('');
  // Sound problems outside a session (the Test sound button) land here; the player installs its own handler while it is mounted.
  const [audioNotice, setAudioNotice] = useState('');
  useEffect(() => { audio.onError = setAudioNotice; return () => { audio.onError = undefined; }; }, [audio]);
  /** A saved workout gets its sharing identity the first time it leaves the household (SHR-05); bundled ones carry theirs. */
  const ensureSharing = useCallback(async (workout: Workout): Promise<Workout> => {
    if (workout.sharing) return workout;
    const existing = saved.find(item => item.id === workout.id);
    if (!existing) return workout;
    const shared = { ...workout, revision: existing.revision + 1, sharing: { id: newId(), sourceRevision: existing.revision + 1 } };
    const result = await data.saveWorkout(shared, existing.revision);
    return result === 'saved' || result === 'queued' ? shared : workout;
  }, [saved, data]);
  const exportOne = useCallback(async (workout: Workout) => exportWorkoutFile(await ensureSharing(workout)), [ensureSharing]);
  const [exportRequest, setExportRequest] = useState<{ title: string; workouts: Workout[]; collections: PackCollection[] }>();
  /** Opens the export preview (SHR-03): what leaves the household is listed with its attribution before the file is written. */
  const requestPackExport = useCallback((title: string, workoutIds: string[], packCollections: PackCollection[] = []) => {
    const chosen = workoutIds.map(id => entries.find(entry => entry.workout.id === id)?.workout).filter((workout): workout is Workout => Boolean(workout));
    if (!chosen.length) { setStorageError('Nothing to export: the collection has no workouts in the library.'); return; }
    setExportRequest({ title, workouts: chosen, collections: packCollections.length ? packCollections : [{ title, workoutIds: chosen.map(workout => workout.id) }] });
  }, [entries]);
  const confirmPackExport = useCallback(async () => {
    if (!exportRequest) return;
    const workouts: Workout[] = [];
    for (const workout of exportRequest.workouts) workouts.push(await ensureSharing(workout));
    exportPackFile({ title: exportRequest.title, workouts, collections: exportRequest.collections.map(collection => ({ ...collection, workoutIds: collection.workoutIds.filter(id => workouts.some(workout => workout.id === id)) })) });
    setExportRequest(undefined);
  }, [exportRequest, ensureSharing]);
  const exportLibrary = useCallback(() => {
    const own = collections.filter(collection => !collection.builtIn);
    requestPackExport('My OpenWOD library', saved.map(item => item.id), own.map(collection => ({ title: collection.title, ...(collection.description ? { description: collection.description } : {}), workoutIds: collection.workoutIds.filter(id => saved.some(item => item.id === id)) })).filter(collection => collection.workoutIds.length));
  }, [collections, saved, requestPackExport]);
  const removeWorkout = useCallback((id: string) => { void data.archiveWorkout(id); }, [data]);
  const addMovement = useCallback((record: Movement) => updateMasterData(current => upsertMovement(current, record)), [updateMasterData]);
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
  /**
   * Saving a draft: replace the saved workout at the next revision (or at the revision the user chose to overwrite
   * after a conflict), or create a new saved workout with a free ID. A derivative of an imported workout gets its own
   * sharing identity and records where it came from (SHR-05).
   */
  const saveDraft = useCallback(async (id: string, mode: StoredDraft['mode'], draft: BuilderDraft, overwriteRevision?: number): Promise<SaveResult> => {
    const existing = mode === 'replace' ? saved.find(item => item.id === id) : undefined;
    if (existing) {
      const base = overwriteRevision ?? existing.revision;
      const sharing = existing.origin === 'imported' && existing.document.sharing ? { id: newId(), sourceRevision: 1, derivedFrom: { id: existing.document.sharing.id, sourceRevision: existing.document.sharing.sourceRevision } } : existing.document.sharing;
      const workout = { ...builderToWorkout(linkDraft(draft, catalogue), { id, revision: base + 1 }), ...(sharing ? { sharing } : {}) };
      const result = await data.saveWorkout(workout, base);
      if (result === 'saved' || result === 'queued') { updateDrafts(current => current.filter(item => item.id !== id)); window.location.hash = workoutHref(id); }
      return result;
    }
    if (saved.length >= SAVED_LIMIT) { setStorageError(`The library keeps up to ${SAVED_LIMIT} saved workouts. Remove one before saving another.`); return 'failed'; }
    const freshId = freeWorkoutId(slugify(draft.title), new Set(entries.map(entry => entry.workout.id)));
    const source = entries.find(entry => entry.workout.id === id)?.workout.sharing;
    const workout = { ...builderToWorkout(linkDraft(draft, catalogue), { id: freshId, revision: 1 }), ...(source ? { sharing: { id: newId(), sourceRevision: 1, derivedFrom: { id: source.id, sourceRevision: source.sourceRevision } } } : {}) };
    const result = await data.saveWorkout(workout, 0);
    if (result === 'saved' || result === 'queued') { updateDrafts(current => current.filter(item => item.id !== id)); window.location.hash = workoutHref(freshId); }
    return result;
  }, [saved, entries, catalogue, data, updateDrafts]);

  // A session interrupted on this device: the player restores it instead of starting fresh (ENG-12); it survives an edit or removal of the workout.
  const recovery = route.name === 'play' ? data.recoveries.find(item => item.checkpoint.workoutId === route.id) : undefined;
  useEffect(() => { if (route.name === 'play') void data.refreshRecoveries(); }, [route, data.refreshRecoveries]);
  // Another tab may be controlling the checkpointed session (ENG-14): ask before restoring it here.
  const [lockState, setLockState] = useState<{ sessionId: string; state: 'checking' | 'free' | 'held' }>();
  useEffect(() => {
    if (!recovery) { setLockState(undefined); return; }
    const sessionId = recovery.checkpoint.sessionId;
    let cancelled = false;
    setLockState({ sessionId, state: 'checking' });
    void probeSessionLock(sessionId).then(state => { if (!cancelled) setLockState({ sessionId, state }); });
    return () => { cancelled = true; };
  }, [recovery?.checkpoint.sessionId]);
  // Until the probe for this checkpoint has answered, the lock is unknown and the player must not mount (it would take the lock itself).
  const lockKnown = recovery ? (lockState?.sessionId === recovery.checkpoint.sessionId ? lockState.state : 'checking') : 'free';
  const takeOver = async () => { if (!recovery) return; await takeOverSession(recovery.checkpoint.sessionId); await data.refreshRecoveries(); setLockState({ sessionId: recovery.checkpoint.sessionId, state: 'free' }); };
  const current = route.name === 'library' || route.name === 'new' || route.name === 'settings' || route.name === 'draft' || route.name === 'history' || route.name === 'historyPlay' ? undefined : entries.find(entry => entry.workout.id === route.id);
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
  const notice = [data.notice, storageError, importReport].filter(Boolean).join(' ');
  const pendingCount = data.pendingIds.size;
  // The running server's version when known (that is what is deployed), else the version this bundle was built from.
  const appVersion = data.serverVersion ?? __OPENWOD_VERSION__;
  const backTarget = current && (route.name === 'play' || route.name === 'edit') ? { href: workoutHref(current.workout.id), label: 'Overview', aria: 'Back to workout overview' } : current || route.name === 'new' || route.name === 'settings' || route.name === 'draft' || route.name === 'history' || route.name === 'historyPlay' ? { href: '#/', label: 'Library', aria: 'Back to library' } : undefined;

  return <div className={styles.app} data-performing={performing}>
    <header className={styles.header}>
      <a href="#/" className={styles.brand} aria-label="OpenWOD library"><BrandMark className={styles.brandMark} /><span className={styles.wordmark}>Open<b>WOD</b></span></a>
      {backTarget ? <a href={backTarget.href} className={styles.backLink} aria-label={backTarget.aria}><Icon name="back" size={17} /><span>{backTarget.label}</span></a> : <span className={styles.headerNote}>Not born. Made.</span>}
      <div className={styles.headerActions}>
        {data.mode === 'server' && (data.connection === 'offline' || data.connection === 'unreachable' || pendingCount > 0) && <span className={styles.pill} data-state={data.connection} title={data.connection === 'online' ? 'Changes are waiting to be uploaded' : 'The household server cannot be reached; this device keeps working and uploads later'}>
          <Icon name={data.connection === 'online' ? 'upload' : 'alert'} size={14} />{data.connection === 'offline' ? 'Offline' : data.connection === 'unreachable' ? 'Server unreachable' : 'Syncing'}{pendingCount > 0 && ` · ${pendingCount} ${pendingCount === 1 ? 'change' : 'changes'} waiting`}
        </span>}
        <button className={styles.quietButton} onClick={() => void audio.test()} disabled={preferences.soundMode === 'silent'}><Icon name="sound" /><span>Test sound</span></button>
        <a className={styles.iconButton} aria-label="History" href={HISTORY_HREF}><Icon name="clock" /></a>
        <a className={styles.iconButton} aria-label="Settings" href={SETTINGS_HREF}><Icon name="settings" /></a>
      </div>
    </header>

    <main className={styles.main}>
      {audioNotice && route.name !== 'play' && <div className={styles.notice} role="status" style={{ marginBottom: 18 }}>{audioNotice} <button type="button" className={styles.quietButton} onClick={() => setAudioNotice('')}>Dismiss</button></div>}
      {route.name === 'play' && (!data.recoveriesReady || lockKnown === 'checking') ? <p className={styles.headerNote}>Checking for an interrupted session…</p>
        : route.name === 'play' && recovery && lockKnown === 'held' ? <section className={styles.recovery} role="region" aria-label="Session in another tab"><div><strong>“{recovery.checkpoint.workout.title}” is running in another tab.</strong><p>Only one tab controls a session. Take it over here and the other tab pauses and hands over, or go back and use that tab.</p></div><div className={styles.dialogActions}><a className={styles.quietButton} href={workoutHref(recovery.checkpoint.workoutId)}>Back to overview</a><button className={styles.primaryButton} onClick={() => void takeOver()}><Icon name="play" />Take over here</button></div></section>
        : route.name === 'play' && (recovery || current) ? <Player key={route.id} workout={recovery ? recovery.checkpoint.workout : current!.workout} recovery={recovery} audio={audio} preferences={preferences} catalogue={catalogue} onPreferencesChange={setPreferences} onPerformingChange={setPerforming} onSessionEnd={recordSession} onSessionClear={clearSession} />
        : route.name === 'historyPlay' ? <SnapshotPlayer sessionId={route.id} fetchSession={data.fetchSession} audio={audio} preferences={preferences} catalogue={catalogue} onPreferencesChange={setPreferences} onPerformingChange={setPerforming} onSessionEnd={recordSession} onSessionClear={clearSession} />
        : route.name === 'history' ? <History mode={data.mode} sessions={sessions} entries={entries} onCorrect={data.correctSession} onLoadMore={data.loadMoreSessions} fetchSession={data.fetchSession} />
        : route.name === 'settings' ? <Settings section={route.section} preferences={preferences} onPreferencesChange={setPreferences} masterData={masterData} onMasterDataChange={updateMasterData} catalogue={catalogue} entries={entries} clipsReady={clipsReady} packs={packs} audio={audio} household={{ mode: data.mode, stats: data.stats, onRestore: data.restore, onExportAll: data.exportAll, connection: data.connection, schemaVersion: data.schemaVersion, serverVersion: data.serverVersion, pendingCount, legacy: data.legacy, migrating: data.migrating, onMigrate: data.migrateDevice, onRefresh: data.refresh, exportPack: requestPackExport }} />
        : editing ? <Editor key={`${editing.id}:${editing.mode}`} mode={editing.mode} workoutId={editing.mode === 'replace' ? editing.id : undefined} initial={editing.initial} importedFrom={'importedFrom' in editing ? editing.importedFrom : undefined} catalogue={catalogue} difficulty={preferences.difficulty} onAddMovement={addMovement} savedAt={editingDraft?.updatedAt} onAutosave={draft => autosaveDraft(editing.id, editing.mode, draft)} onSave={(draft, overwrite) => saveDraft(editing.id, editing.mode, draft, overwrite)} onDiscard={() => { discardDraft(editing.id); window.location.hash = editing.mode === 'replace' ? workoutHref(editing.id) : '#/'; }} />
        : route.name === 'draft' ? <div className={styles.notice} role="status">That imported draft is no longer on this device. <a href="#/">Back to the library</a>.</div>
        : route.name === 'edit' && current ? <div className={styles.notice} role="status">“{current.summary.title}” uses a structure the editor cannot change yet. You can still export it or read through it. <a href={workoutHref(current.workout.id)}>Back to the overview</a>.</div>
        : current ? <Overview key={current.workout.id} entry={current} names={preferences.names} collections={collections.filter(collection => collection.workoutIds.includes(current.workout.id))} sessions={sessions.filter(session => session.workoutId === current.workout.id)} loadsFor={preferences.loadsFor} loadUnit={preferences.loadUnit} onRemove={removeWorkout} onExport={workout => { void exportOne(workout); }} />
        : <Library mode={data.mode} entries={entries} collections={collections} sessions={sessions} onImportPack={importPack} onImportDraft={importDraft} onExportLibrary={exportLibrary} notice={notice} onClearNotice={() => { data.clearNotice(); setStorageError(''); setImportReport(''); }} missingId={route.name === 'library' ? undefined : (route as { id?: string }).id} drafts={drafts} onDiscardDraft={discardDraft} preferences={preferences} onPreferencesChange={setPreferences} connection={data.connection} legacy={data.legacy} migrating={data.migrating} onMigrate={data.migrateDevice} conflicts={data.conflicts} rejected={data.rejected} onResolveConflict={data.resolveConflict} onDismissRejected={data.dismissRejected} recoveries={data.recoveries} onDiscardRecovery={data.clearRecovery} />}
      <ConfirmDialog open={Boolean(exportRequest)} title={`Export “${exportRequest?.title ?? ''}” as a pack?`} confirmLabel={`Export ${exportRequest?.workouts.length ?? 0} ${exportRequest?.workouts.length === 1 ? 'workout' : 'workouts'}`} cancelLabel="Cancel" onClose={() => setExportRequest(undefined)} onConfirm={() => void confirmPackExport()}>
        <p>The file carries the workouts below with their attribution. Household names, results and settings stay here.</p>
        <ul className={styles.exportList}>{exportRequest?.workouts.map(workout => <li key={workout.id}><strong>{workout.title}</strong>{workout.attribution && <small>{[workout.attribution.author ? `by ${workout.attribution.author}` : '', workout.attribution.sourceUrl ?? '', workout.attribution.notes ?? ''].filter(Boolean).join(' · ')}</small>}</li>)}</ul>
      </ConfirmDialog>
      <footer className={styles.footer}><span>NOT BORN. <em className={styles.made}>MADE.</em></span><span className={styles.footerLinks}><span className={styles.footerMode} tabIndex={0} data-tip={SHAPE_TIPS[data.mode]} aria-label={`${SHAPE_LABELS[data.mode]}: ${SHAPE_TIPS[data.mode]}`}>{SHAPE_LABELS[data.mode]}</span><a href={`${__OPENWOD_REPO__}/releases/tag/v${appVersion}`} target="_blank" rel="noreferrer" title="Release notes">v{appVersion}</a><a className={styles.footerRepo} href={__OPENWOD_REPO__} target="_blank" rel="noreferrer" title="Source code on GitHub"><Icon name="github" size={15} />OpenWOD</a><a href={`${import.meta.env.BASE_URL}LICENSE`} target="_blank" rel="noreferrer" title="GNU General Public License, version 3">GPLv3</a></span></footer>
    </main>
  </div>;
}
