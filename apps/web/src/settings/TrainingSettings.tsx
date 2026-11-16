import { Fragment, type CSSProperties } from 'react';
import { TimerPreview } from './TimerPreview';
import type { Preferences } from '../preferences';
import { Switch } from '../Switch';
import { Icon } from '../Icon';
import { BEEP_TONES } from '../audio';
import styles from '../Settings.module.css';
import shared from '../App.module.css';
import { type SettingsProps } from './shared';
import { ColorField, type ColorOptions } from './ColorField';
import { BUILT_IN_COLORS, restTokens, useResolvedTheme, type Theme } from '../theme';

/** Ready-made rest colours; the first is the built-in blue. Any other colour comes from the picker. */
const REST_COLORS: ColorOptions = [['', 'Blue'], ['#06b6d4', 'Cyan'], ['#2a9d8f', 'Teal'], ['#8b5cf6', 'Violet'], ['#ec4899', 'Pink'], ['#f59e0b', 'Amber']];
const restShade = (value: string, theme: Theme) => value ? restTokens(value, theme)['--phase-rest'] : BUILT_IN_COLORS.rest[theme];
/** A colour the player shows exactly as picked, or the theme's own while there is none. */
const asPicked = (builtIn: Record<Theme, string>) => (value: string, theme: Theme) => value || builtIn[theme];

export function TrainingSettings(props: SettingsProps) {
  const { preferences, onPreferencesChange } = props;
  const update = (patch: Partial<Preferences>) => onPreferencesChange(value => ({ ...value, ...patch }));
  const seconds = (ms: number) => `${Math.round(ms / 1000)} s`;
  const theme = useResolvedTheme(preferences.theme);
  const { markColors } = preferences;
  /** Every phase colour but the work phase's, which is the accent: each theme has its own choice of each. */
  const phases: { name: string; value: Record<Theme, string>; shade: (value: string, theme: Theme) => string; options?: ColorOptions; set: (value: Record<Theme, string>) => void }[] = [
    { name: 'Rest', value: preferences.restColor, shade: restShade, options: REST_COLORS, set: restColor => update({ restColor }) },
    { name: 'Paused', value: preferences.pauseColor, shade: asPicked(BUILT_IN_COLORS.paused), set: pauseColor => update({ pauseColor }) },
    { name: 'First milestone', value: markColors.first, shade: asPicked(BUILT_IN_COLORS.amber), set: first => update({ markColors: { ...markColors, first } }) },
    { name: 'Second milestone', value: markColors.second, shade: asPicked(BUILT_IN_COLORS.red), set: second => update({ markColors: { ...markColors, second } }) },
  ];
  return <>
    <section className={styles.card} aria-labelledby="units-title">
      <h2 id="units-title">Loads</h2>
      <div className={styles.field}><span id="unit-label">Show weights in</span><div className={shared.segmented} data-two role="radiogroup" aria-labelledby="unit-label">{(['kg', 'lb'] as const).map(unit => <label key={unit} data-checked={preferences.loadUnit === unit}><input type="radio" name="load-unit" value={unit} checked={preferences.loadUnit === unit} onChange={() => update({ loadUnit: unit })} />{unit === 'kg' ? 'Kilograms' : 'Pounds'}</label>)}</div></div>
      <p className={styles.hint}>Workouts written in the other unit are converted on screen and rounded to plate-friendly numbers (95 lb ↔ 43 kg). Percentages of a one-rep max stay as written.</p>
    </section>
    <section className={styles.card} aria-labelledby="player-title">
      <h2 id="player-title">Look &amp; feel</h2>
      <div className={styles.previewRow}>
        <TimerPreview view={preferences.view} ringWidth={preferences.perimeterWidth} washGain={preferences.wash ? preferences.washGain : 0} amberMs={preferences.amberMs} redMs={preferences.redMs} colors={{ first: markColors.first[theme], second: markColors.second[theme] }} progress={preferences.progress} />
        <div className={styles.previewFields}>
          <div className={styles.field}><span id="view-label">Default view</span><div className={shared.segmented} data-two role="radiogroup" aria-labelledby="view-label">{([['focus', 'Focus', 'focus'], ['context', 'Context', 'list']] as const).map(([value, label, icon]) => <label key={value} data-checked={preferences.view === value}><input type="radio" name="view" value={value} checked={preferences.view === value} onChange={() => update({ view: value })} /><Icon name={icon} size={16} />{label}</label>)}</div></div>
          <div className={styles.field}><span id="progress-label">Overall progress</span><div className={styles.checkGrid} role="group" aria-labelledby="progress-label">{([['bar', 'Overall bar'], ['barPercent', 'Percentage under the bar'], ['clockPercent', 'Percentage beside the clock'], ['donut', 'Round donut']] as const).map(([part, label]) => <label key={part}><input type="checkbox" checked={preferences.progress[part]} onChange={event => update({ progress: { ...preferences.progress, [part]: event.target.checked } })} />{label}</label>)}</div></div>
          <div className={styles.twoUp}>
            <label className={styles.field}>Timer ring width · {preferences.perimeterWidth} px<input type="range" min="3" max="12" step="1" value={preferences.perimeterWidth} onChange={event => update({ perimeterWidth: Number(event.target.value) })} /></label>
            <label className={styles.field}>Skip buttons · {preferences.nudgeSeconds} s<input type="range" min="1" max="60" step="1" value={preferences.nudgeSeconds} onChange={event => update({ nudgeSeconds: Number(event.target.value) })} /></label>
          </div>
          <div className={styles.twoUp}>
            <label className={styles.field}><span>First milestone marker · {seconds(preferences.amberMs)}</span><input type="range" min="5" max="30" step="1" aria-label="First milestone marker" value={preferences.amberMs / 1000} onChange={event => { const amberMs = Number(event.target.value) * 1000; update({ amberMs, redMs: Math.min(preferences.redMs, amberMs) }); }} /></label>
            <label className={styles.field}><span>Second milestone marker · {seconds(preferences.redMs)}</span><input type="range" min="1" max={Math.min(10, preferences.amberMs / 1000)} step="1" aria-label="Second milestone marker" value={preferences.redMs / 1000} onChange={event => update({ redMs: Number(event.target.value) * 1000 })} /></label>
          </div>
          <div className={`${styles.field} ${styles.phaseColors}`} role="group" aria-label="Phase colours">
            <span /><span className={styles.themeName}>Dark</span><span className={styles.themeName}>Light</span>
            {phases.map(phase => <Fragment key={phase.name}><span>{phase.name}</span>{(['dark', 'light'] as const).map(name => <ColorField key={name} label={`${phase.name} colour in the ${name} theme`} options={phase.options} value={phase.value[name]} shade={value => phase.shade(value, name)} onChange={value => phase.set({ ...phase.value, [name]: value })} />)}</Fragment>)}
          </div>
          <p className={styles.hint}>Work changes colour at each marker this long before a slot ends; the markers sit on the ring above. Short slots cap them at a quarter and a tenth of their length, and the spoken countdown stays at three seconds. The skip buttons and the J and L keys move the clock by the chosen seconds. The percentage beside the clock reads as in 00:39 · 4 %, dimmer than the digits; the round donut counts the movements of a round and the rounds of a block.</p>
          <p className={styles.hint}>Each theme keeps its own colours. Rest also covers transitions and the lane that waits for its partner, and is shown in the shade that theme will use. The work phase follows the accent under General.</p>
        </div>
      </div>
      <Switch checked={preferences.wash} onChange={wash => update({ wash })} label="Background pulse" hint="The phase colour tints the whole player, climbing to full strength just before each milestone and morphing into the next colour." />
      {preferences.wash && <label className={styles.field}>Pulse intensity · {preferences.washGain} %<input type="range" min="10" max="60" step="5" value={preferences.washGain} onChange={event => update({ washGain: Number(event.target.value) })} /></label>}
    </section>
    <SoundSettings {...props} />
  </>;
}

export function SoundSettings({ preferences, onPreferencesChange, clipsReady, packs, audio }: SettingsProps) {
  const update = (patch: Partial<Preferences>) => onPreferencesChange(value => ({ ...value, ...patch }));
  /** The voice in use: the device's, the chosen pack, or the first pack while none was chosen ('' when no pack is installed). */
  const voice = preferences.cueSource === 'device' ? 'device' : preferences.cuePack || (packs[0]?.id ?? '');
  /** The cells of the Voice toggle to a row, so that no slot stays empty where the count allows it: two or three cells share one row, six make two rows of three, four two rows of two. */
  const cells = Math.max(packs.length, 1) + 1;
  const voiceColumns = cells <= 3 ? cells : cells % 3 === 0 ? 3 : cells % 2 === 0 ? 2 : 3;
  return <section className={styles.card} aria-labelledby="sound-title">
    <h2 id="sound-title">Sound and voice</h2>
    <div className={styles.field}><span id="sound-label">Sound</span><div className={shared.segmented} role="radiogroup" aria-labelledby="sound-label">{([['voice', 'Voice + beeps'], ['beeps', 'Beeps only'], ['silent', 'Silent']] as const).map(([value, label]) => <label key={value} data-checked={preferences.soundMode === value}><input type="radio" name="sound-mode" value={value} checked={preferences.soundMode === value} onChange={() => update({ soundMode: value })} />{label}</label>)}</div></div>
    <div className={styles.field}><span id="voice-label">Voice</span><div className={`${shared.segmented} ${styles.voices}`} style={{ '--voice-columns': voiceColumns } as CSSProperties} role="radiogroup" aria-labelledby="voice-label">
      {packs.map(pack => <label key={pack.id} data-checked={voice === pack.id}><input type="radio" name="voice" value={pack.id} checked={voice === pack.id} onChange={() => update({ cueSource: 'clips', cuePack: pack.id })} />{pack.label}</label>)}
      {packs.length === 0 && <label data-checked={voice === ''}><input type="radio" name="voice" value="" checked={voice === ''} disabled />Recorded voices (not installed in this build)</label>}
      <label data-checked={voice === 'device'}><input type="radio" name="voice" value="device" checked={voice === 'device'} onChange={() => update({ cueSource: 'device' })} />Device voice only</label>
    </div></div>
    <div className={styles.notes}>
      {preferences.cueSource === 'clips' && clipsReady === false && <small className={shared.fieldNote}>The recorded voices are not installed in this build, so the device voice is used. The Docker image renders them; locally run `npm run cues:generate`.</small>}
      {/* The toggle above lists the voices this build carries, so the note names none and counts none. */}
      <small className={shared.fieldNote}>The recorded voices are rendered offline with Piper and ship with the app. The chosen voice says Go, Rest, the countdown, who is up and every bundled movement. Your own movements are read by the device’s best English voice.</small>
    </div>
    <div className={styles.twoUp}>
      <label className={styles.field}>Device voice speed<input type="range" min="0.7" max="1.3" step="0.1" value={preferences.rate} onChange={event => update({ rate: Number(event.target.value) })} /></label>
      <label className={styles.field}>Voice volume<input type="range" min="0" max="1" step="0.1" value={preferences.volume} onChange={event => update({ volume: Number(event.target.value) })} /></label>
    </div>
    <div className={styles.twoUp}>
      <label className={styles.field}>Beep tone<select value={preferences.beepTone} onChange={event => { update({ beepTone: event.target.value as Preferences['beepTone'] }); audio.tone = event.target.value as Preferences['beepTone']; void audio.testBeeps(); }}>{BEEP_TONES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className={styles.field}>Beep volume<input type="range" min="0" max="1" step="0.1" value={preferences.beepVolume} onChange={event => update({ beepVolume: Number(event.target.value) })} /></label>
    </div>
    <small className={shared.fieldNote}>The beeps have their own level, so they can be louder than the voice when music is playing. Gym timer is the long, held beep of a gym clock, Alarm is harsher still, and Truck horn plays a recorded air horn. Choosing a tone plays it.</small>
    {/* Each part of the sound on its own and both as a session plays them. A test follows the Sound choice above, so there is no voice to test while it is off. */}
    <div className={styles.buttonRow}>
      <button type="button" className={shared.quietButton} onClick={() => void audio.testVoice()} disabled={preferences.soundMode !== 'voice'}><Icon name="sound" />Test voice</button>
      <button type="button" className={shared.quietButton} onClick={() => void audio.testBeeps()} disabled={preferences.soundMode === 'silent'}><Icon name="sound" />Test beeps</button>
      <button type="button" className={shared.quietButton} onClick={() => void audio.test()} disabled={preferences.soundMode !== 'voice'}><Icon name="sound" />Test both</button>
    </div>
  </section>;
}
