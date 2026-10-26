import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Workout } from '../../../packages/domain/src';
import { fixtureWorkouts } from '../../../packages/domain/src/fixtures';
import { pickDefaultVoice, sortVoices, WorkoutAudio } from './audio';
import { Library, toEntry, type LibraryEntry } from './Library';
import { Player } from './Player';
import { Overview } from './Overview';
import { Editor } from './Editor';
import { builderToWorkout, emptyDraft, workoutToBuilder, type BuilderDraft } from '../../../packages/domain/src/builder';
import { freeWorkoutId, loadDrafts, loadSavedWorkouts, NEW_DRAFT_ID, persistDrafts, persistSavedWorkouts, SAVED_LIMIT, slugify, type StoredDraft } from './library-store';
import { loadPreferences, savePreferences, type Preferences } from './preferences';
import { useRoute, workoutHref } from './router';
import { useTheme } from './theme';
import { Icon } from './Icon';
import { LevelPicker } from './LevelChip';
import { equipmentOptions } from '../../../packages/domain/src/library';
import styles from './App.module.css';

const bundledEntries = fixtureWorkouts.map(workout => toEntry(workout, 'bundled'));

export default function App() {
  const { route } = useRoute();
  const [preferences, setPreferences] = useState(loadPreferences);
  const [saved, setSaved] = useState(loadSavedWorkouts);
  const [drafts, setDrafts] = useState(loadDrafts);
  const [storageError, setStorageError] = useState('');
  const [performing, setPerforming] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [clipsReady, setClipsReady] = useState<boolean>();
  const settings = useRef<HTMLDialogElement>(null);
  const audioRef = useRef<WorkoutAudio>(null);
  audioRef.current ??= new WorkoutAudio();
  const audio = audioRef.current;
  audio.mode = preferences.soundMode;
  audio.cueSource = preferences.cueSource;
  audio.onClips = setClipsReady;
  audio.voiceURI = preferences.voiceURI;
  audio.rate = preferences.rate;
  audio.volume = preferences.volume;

  useTheme(preferences.theme);
  useEffect(() => savePreferences(preferences), [preferences]);
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const update = () => setVoices(sortVoices(window.speechSynthesis.getVoices()));
    update();
    window.speechSynthesis.addEventListener('voiceschanged', update);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', update);
  }, []);
  useEffect(() => { if (route.name !== 'play') window.scrollTo(0, 0); }, [route]);

  const savedEntries = useMemo(() => saved.map(workout => toEntry(workout, 'saved')), [saved]);
  const entries = useMemo<LibraryEntry[]>(() => [...bundledEntries, ...savedEntries], [savedEntries]);
  const updateSaved = useCallback((next: Workout[]) => { setSaved(next); setStorageError(persistSavedWorkouts(next) ?? ''); }, []);
  const importWorkout = useCallback((workout: Workout, mode: 'copy' | 'replace') => {
    if (mode === 'replace') { updateSaved(saved.map(item => item.id === workout.id ? workout : item)); return; }
    if (saved.length >= SAVED_LIMIT) { setStorageError(`This device keeps up to ${SAVED_LIMIT} imported workouts. Remove one before importing another.`); return; }
    const id = freeWorkoutId(workout.id, new Set(entries.map(entry => entry.workout.id)));
    updateSaved([...saved, { ...workout, id }]);
  }, [saved, entries, updateSaved]);
  const removeWorkout = useCallback((id: string) => updateSaved(saved.filter(item => item.id !== id)), [saved, updateSaved]);
  // Draft updates are functional so autosave never depends on a stale list and never changes identity.
  const updateDrafts = useCallback((change: (current: StoredDraft[]) => StoredDraft[]) => setDrafts(current => { const next = change(current); const error = persistDrafts(next); if (error) setStorageError(error); return next; }), []);
  const discardDraft = useCallback((id: string) => updateDrafts(current => current.filter(draft => draft.id !== id)), [updateDrafts]);
  const autosaveDraft = useCallback((id: string, mode: StoredDraft['mode'], draft: BuilderDraft) => {
    const record: StoredDraft = { id, mode, draft, updatedAt: new Date().toISOString() };
    updateDrafts(current => [record, ...current.filter(item => item.id !== id)]);
  }, [updateDrafts]);
  /** Saving a draft: replace the saved workout at the next revision, or create a new saved workout with a free ID. */
  const saveDraft = useCallback((id: string, mode: StoredDraft['mode'], draft: BuilderDraft) => {
    const existing = mode === 'replace' ? saved.find(item => item.id === id) : undefined;
    if (existing) {
      updateSaved(saved.map(item => item.id === id ? builderToWorkout(draft, { id, revision: existing.revision + 1 }) : item));
      updateDrafts(current => current.filter(item => item.id !== id));
      window.location.hash = workoutHref(id);
      return;
    }
    if (saved.length >= SAVED_LIMIT) { setStorageError(`This device keeps up to ${SAVED_LIMIT} saved workouts. Remove one before saving another.`); return; }
    const newId = freeWorkoutId(slugify(draft.title), new Set(entries.map(entry => entry.workout.id)));
    updateSaved([...saved, builderToWorkout(draft, { id: newId, revision: 1 })]);
    updateDrafts(current => current.filter(item => item.id !== id));
    window.location.hash = workoutHref(newId);
  }, [saved, entries, updateSaved, updateDrafts]);

  const current = route.name === 'library' || route.name === 'new' ? undefined : entries.find(entry => entry.workout.id === route.id);
  // Editor inputs: a resumed draft wins; otherwise the workout itself, or a titled copy of a bundled one.
  const editing = route.name === 'new' ? { id: NEW_DRAFT_ID, mode: 'create' as const, initial: drafts.find(draft => draft.id === NEW_DRAFT_ID)?.draft ?? emptyDraft(2) }
    : route.name === 'edit' && current ? (() => {
      const mode = current.source === 'saved' ? 'replace' as const : 'create' as const;
      const stored = drafts.find(draft => draft.id === current.workout.id);
      const fromWorkout = workoutToBuilder(current.workout);
      const initial = stored?.draft ?? (fromWorkout && mode === 'create' ? { ...fromWorkout, title: `Copy of ${fromWorkout.title}` } : fromWorkout);
      return initial ? { id: current.workout.id, mode, initial } : undefined;
    })() : undefined;
  const editingDraft = editing && drafts.find(draft => draft.id === editing.id);
  const update = (patch: Partial<Preferences>) => setPreferences(value => ({ ...value, ...patch }));
  const equipmentChoices = useMemo(() => equipmentOptions(entries.map(entry => entry.summary)), [entries]);

  return <div className={styles.app} data-performing={performing}>
    <header className={styles.header}>
      <a href="#/" className={styles.brand} aria-label="Wodva library"><span className={styles.brandMark}><svg viewBox="0 0 30 30" aria-hidden="true"><path d="m4 8 5 15 6-10 6 10 5-15" /></svg></span>wodva<span className={styles.brandDot}>.</span></a>
      {current && (route.name === 'play' || route.name === 'edit') ? <a href={workoutHref(current.workout.id)} className={styles.backLink} aria-label="Back to workout overview"><Icon name="back" size={17} /><span>Overview</span></a> : current || route.name === 'new' ? <a href="#/" className={styles.backLink} aria-label="Back to library"><Icon name="back" size={17} /><span>Library</span></a> : <span className={styles.headerNote}>A little stronger, together.</span>}
      <div className={styles.headerActions}>
        <button className={styles.quietButton} onClick={() => void audio.test()} disabled={preferences.soundMode === 'silent'}><Icon name="sound" /><span>Test sound</span></button>
        <button className={styles.iconButton} aria-label="Player settings" onClick={() => settings.current?.showModal()}><Icon name="settings" /></button>
      </div>
    </header>

    <main className={styles.main}>
      {current && route.name === 'play' ? <Player key={current.workout.id} workout={current.workout} audio={audio} preferences={preferences} onPreferencesChange={setPreferences} onPerformingChange={setPerforming} />
        : editing ? <Editor key={`${editing.id}:${editing.mode}`} mode={editing.mode} initial={editing.initial} savedAt={editingDraft?.updatedAt} onAutosave={draft => autosaveDraft(editing.id, editing.mode, draft)} onSave={draft => saveDraft(editing.id, editing.mode, draft)} onDiscard={() => { discardDraft(editing.id); window.location.hash = editing.mode === 'replace' ? workoutHref(editing.id) : '#/'; }} />
        : route.name === 'edit' && current ? <div className={styles.notice} role="status">“{current.summary.title}” uses a structure the editor cannot change yet. You can still export it or read through it. <a href={workoutHref(current.workout.id)}>Back to the overview</a>.</div>
        : current ? <Overview key={current.workout.id} entry={current} names={preferences.names} onRemove={removeWorkout} />
        : <Library entries={entries} onImport={importWorkout} onRemove={removeWorkout} storageError={storageError} missingId={route.name === 'library' || route.name === 'new' ? undefined : route.id} drafts={drafts} onDiscardDraft={discardDraft} preferences={preferences} onPreferencesChange={setPreferences} />}
      <footer className={styles.footer}><span>BUILT FOR YOUR EVERYDAY STRONG.</span><span>Player preview · workouts run locally · <a href="/LICENSE" target="_blank" rel="noreferrer">GPLv3</a></span></footer>
    </main>

    <dialog ref={settings} className={styles.dialog} aria-labelledby="settings-title"><div className={styles.dialogHeading}><h2 id="settings-title">Make it yours</h2><button className={styles.iconButton} aria-label="Close settings" onClick={() => settings.current?.close()}><Icon name="close" /></button></div><p className={styles.dialogIntro}>Saved on this device. A few things to set before you get moving.</p>
      <fieldset className={styles.segmented}><legend>Appearance</legend>{([['auto', 'Auto', 'auto'], ['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']] as const).map(([value, label, icon]) => <label key={value} data-checked={preferences.theme === value}><input type="radio" name="theme" value={value} checked={preferences.theme === value} onChange={() => update({ theme: value })} /><Icon name={icon} size={16} />{label}</label>)}</fieldset>
      <div className={styles.nameFields}>{(['A', 'B'] as const).map(role => <label key={role}>Athlete {role}<input maxLength={30} value={preferences.names[role]} onChange={event => update({ names: { ...preferences.names, [role]: event.target.value } })} /></label>)}</div>
      <div className={styles.settingsBlock}><span className={styles.settingsLabel}>Load levels</span><LevelPicker levels={preferences.levels} participants={2} names={preferences.names} onChange={levels => update({ levels })} /><small className={styles.fieldNote}>Blue is light, red is medium, black is heavy. Workouts with levelled loads show the weight for each athlete’s choice.</small></div>
      <div className={styles.settingsBlock}><span className={styles.settingsLabel}>My equipment</span><div className={styles.chipGrid}>{equipmentChoices.map(item => <label key={item} className={styles.chipToggle} data-checked={preferences.myEquipment.includes(item)}><input type="checkbox" checked={preferences.myEquipment.includes(item)} onChange={event => update({ myEquipment: event.target.checked ? [...preferences.myEquipment, item] : preferences.myEquipment.filter(known => known !== item) })} />{item}</label>)}</div><small className={styles.fieldNote}>Tick what you have at home. The library can then show only workouts that need nothing more.</small></div>
      <label>Sound<select value={preferences.soundMode} onChange={event => update({ soundMode: event.target.value as Preferences['soundMode'] })}><option value="voice">Voice + beeps</option><option value="beeps">Beeps only</option><option value="silent">Silent</option></select></label>
      <label>Fixed cues (Go, Rest, countdown)<select value={preferences.cueSource} onChange={event => update({ cueSource: event.target.value as Preferences['cueSource'] })}><option value="clips">Recorded voice (recommended)</option><option value="device">Device voice</option></select>{preferences.cueSource === 'clips' && clipsReady === false && <small className={styles.fieldNote}>Recorded cues are not installed in this build, so the device voice is used.</small>}</label>
      <label>Device voice for movement names<select value={preferences.voiceURI} onChange={event => update({ voiceURI: event.target.value })}><option value="">{pickDefaultVoice(voices) ? `Best available (${pickDefaultVoice(voices)!.name})` : 'Device default'}</option>{voices.map(voice => <option value={voice.voiceURI} key={voice.voiceURI}>{voice.name} · {voice.lang}</option>)}</select></label>
      <label>Speech speed<input type="range" min="0.7" max="1.3" step="0.1" value={preferences.rate} onChange={event => update({ rate: Number(event.target.value) })} /></label>
      <label>Volume<input type="range" min="0" max="1" step="0.1" value={preferences.volume} onChange={event => update({ volume: Number(event.target.value) })} /></label>
      <p className={styles.dialogIntro}>Switching tabs pauses your workout. Keep this window visible while training.</p>
      <button className={styles.primaryButton} onClick={() => void audio.test()} disabled={preferences.soundMode === 'silent'}><Icon name="sound" />Test sound</button>
    </dialog>
  </div>;
}
