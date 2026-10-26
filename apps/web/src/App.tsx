import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Workout } from '../../../packages/domain/src';
import { fixtureWorkouts } from '../../../packages/domain/src/fixtures';
import { WorkoutAudio } from './audio';
import { Library, toEntry, type LibraryEntry } from './Library';
import { Player } from './Player';
import { freeWorkoutId, loadSavedWorkouts, persistSavedWorkouts, SAVED_LIMIT } from './library-store';
import { loadPreferences, savePreferences, type Preferences } from './preferences';
import { useRoute } from './router';
import { useTheme } from './theme';
import { Icon } from './Icon';
import styles from './App.module.css';

const bundledEntries = fixtureWorkouts.map(workout => toEntry(workout, 'bundled'));

export default function App() {
  const { route } = useRoute();
  const [preferences, setPreferences] = useState(loadPreferences);
  const [saved, setSaved] = useState(loadSavedWorkouts);
  const [storageError, setStorageError] = useState('');
  const [performing, setPerforming] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const settings = useRef<HTMLDialogElement>(null);
  const audioRef = useRef<WorkoutAudio>(null);
  audioRef.current ??= new WorkoutAudio();
  const audio = audioRef.current;
  audio.mode = preferences.soundMode;
  audio.voiceURI = preferences.voiceURI;
  audio.rate = preferences.rate;
  audio.volume = preferences.volume;

  useTheme(preferences.theme);
  useEffect(() => savePreferences(preferences), [preferences]);
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const update = () => setVoices(window.speechSynthesis.getVoices());
    update();
    window.speechSynthesis.addEventListener('voiceschanged', update);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', update);
  }, []);
  useEffect(() => { if (route.name === 'library') window.scrollTo(0, 0); }, [route]);

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

  const current = route.name === 'workout' ? entries.find(entry => entry.workout.id === route.id) : undefined;
  const update = (patch: Partial<Preferences>) => setPreferences(value => ({ ...value, ...patch }));

  return <div className={styles.app} data-performing={performing}>
    <header className={styles.header}>
      <a href="#/" className={styles.brand} aria-label="Wodva library"><span className={styles.brandMark}><svg viewBox="0 0 30 30" aria-hidden="true"><path d="m4 8 5 15 6-10 6 10 5-15" /></svg></span>wodva<span className={styles.brandDot}>.</span></a>
      {current ? <a href="#/" className={styles.backLink} aria-label="Back to library"><Icon name="back" size={17} /><span>Library</span></a> : <span className={styles.headerNote}>A little stronger, together.</span>}
      <div className={styles.headerActions}>
        <button className={styles.quietButton} onClick={() => void audio.test()} disabled={preferences.soundMode === 'silent'}><Icon name="sound" /><span>Test sound</span></button>
        <button className={styles.iconButton} aria-label="Player settings" onClick={() => settings.current?.showModal()}><Icon name="settings" /></button>
      </div>
    </header>

    <main className={styles.main}>
      {current ? <Player key={current.workout.id} workout={current.workout} audio={audio} preferences={preferences} onPreferencesChange={setPreferences} onPerformingChange={setPerforming} />
        : <Library entries={entries} onImport={importWorkout} onRemove={removeWorkout} storageError={storageError} missingId={route.name === 'workout' ? route.id : undefined} />}
      <footer className={styles.footer}><span>BUILT FOR YOUR EVERYDAY STRONG.</span><span>Player preview · workouts run locally · <a href="/LICENSE" target="_blank" rel="noreferrer">GPLv3</a></span></footer>
    </main>

    <dialog ref={settings} className={styles.dialog} aria-labelledby="settings-title"><div className={styles.dialogHeading}><h2 id="settings-title">Make it yours</h2><button className={styles.iconButton} aria-label="Close settings" onClick={() => settings.current?.close()}><Icon name="close" /></button></div><p className={styles.dialogIntro}>Saved on this device. A few things to set before you get moving.</p>
      <fieldset className={styles.segmented}><legend>Appearance</legend>{([['auto', 'Auto', 'auto'], ['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']] as const).map(([value, label, icon]) => <label key={value} data-checked={preferences.theme === value}><input type="radio" name="theme" value={value} checked={preferences.theme === value} onChange={() => update({ theme: value })} /><Icon name={icon} size={16} />{label}</label>)}</fieldset>
      <div className={styles.nameFields}>{(['A', 'B'] as const).map(role => <label key={role}>Athlete {role}<input maxLength={30} value={preferences.names[role]} onChange={event => update({ names: { ...preferences.names, [role]: event.target.value } })} /></label>)}</div>
      <label>Sound<select value={preferences.soundMode} onChange={event => update({ soundMode: event.target.value as Preferences['soundMode'] })}><option value="voice">Voice + beeps</option><option value="beeps">Beeps only</option><option value="silent">Silent</option></select></label>
      <label>Voice<select value={preferences.voiceURI} onChange={event => update({ voiceURI: event.target.value })}><option value="">Device default</option>{voices.map(voice => <option value={voice.voiceURI} key={voice.voiceURI}>{voice.name} · {voice.lang}</option>)}</select></label>
      <label>Speech speed<input type="range" min="0.7" max="1.3" step="0.1" value={preferences.rate} onChange={event => update({ rate: Number(event.target.value) })} /></label>
      <label>Volume<input type="range" min="0" max="1" step="0.1" value={preferences.volume} onChange={event => update({ volume: Number(event.target.value) })} /></label>
      <p className={styles.dialogIntro}>Switching tabs pauses your workout. Keep this window visible while training.</p>
      <button className={styles.primaryButton} onClick={() => void audio.test()} disabled={preferences.soundMode === 'silent'}><Icon name="sound" />Test sound</button>
    </dialog>
  </div>;
}
