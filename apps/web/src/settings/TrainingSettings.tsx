import { TimerPreview } from './TimerPreview';
import type { Preferences } from '../preferences';
import { Switch } from '../Switch';
import { Icon } from '../Icon';
import styles from '../Settings.module.css';
import shared from '../App.module.css';
import { type SettingsProps } from './shared';

export function TrainingSettings(props: SettingsProps) {
  const { preferences, onPreferencesChange } = props;
  const update = (patch: Partial<Preferences>) => onPreferencesChange(value => ({ ...value, ...patch }));
  const seconds = (ms: number) => `${Math.round(ms / 1000)} s`;
  /** The theme's own marker colour, as the colour input needs a concrete value. */
  const themeColor = (token: string) => { const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim(); return /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'; };
  return <>
    <section className={styles.card} aria-labelledby="units-title">
      <h2 id="units-title">Loads</h2>
      <div className={styles.field}><span id="unit-label">Show weights in</span><div className={shared.segmented} data-two role="radiogroup" aria-labelledby="unit-label">{(['kg', 'lb'] as const).map(unit => <label key={unit} data-checked={preferences.loadUnit === unit}><input type="radio" name="load-unit" value={unit} checked={preferences.loadUnit === unit} onChange={() => update({ loadUnit: unit })} />{unit === 'kg' ? 'Kilograms' : 'Pounds'}</label>)}</div></div>
      <p className={styles.hint}>Workouts written in the other unit are converted on screen and rounded to plate-friendly numbers (95 lb ↔ 43 kg). Percentages of a one-rep max stay as written.</p>
    </section>
    <section className={styles.card} aria-labelledby="player-title">
      <h2 id="player-title">Look &amp; feel</h2>
      <div className={styles.previewRow}>
        <TimerPreview view={preferences.view} ringWidth={preferences.perimeterWidth} washGain={preferences.wash ? preferences.washGain : 0} amberMs={preferences.amberMs} redMs={preferences.redMs} colors={preferences.markColors} progress={preferences.progress} clockWeight={preferences.clockWeight} clockSize={preferences.clockSize} />
        <div className={styles.previewFields}>
          <label className={styles.field}>Default view<select value={preferences.view} onChange={event => update({ view: event.target.value as Preferences['view'] })}><option value="focus">Focus</option><option value="context">Context</option></select></label>
          <div className={styles.field}><span id="progress-label">Overall progress</span><div className={shared.segmented} role="radiogroup" aria-labelledby="progress-label">{([['off', 'Off'], ['bar', 'Bar'], ['detail', 'Bar and numbers']] as const).map(([value, label]) => <label key={value} data-checked={preferences.progress === value}><input type="radio" name="progress" value={value} checked={preferences.progress === value} onChange={() => update({ progress: value })} />{label}</label>)}</div></div>
          <div className={styles.twoUp}>
            <div className={styles.field}><span id="clock-weight-label">Clock digits</span><div className={shared.segmented} data-two role="radiogroup" aria-labelledby="clock-weight-label">{([['bold', 'Bold'], ['light', 'Light']] as const).map(([value, label]) => <label key={value} data-checked={preferences.clockWeight === value}><input type="radio" name="clock-weight" value={value} checked={preferences.clockWeight === value} onChange={() => update({ clockWeight: value })} />{label}</label>)}</div></div>
            <div className={styles.field}><span id="clock-size-label">Clock size</span><div className={shared.segmented} data-two role="radiogroup" aria-labelledby="clock-size-label">{([['large', 'Large'], ['compact', 'Compact']] as const).map(([value, label]) => <label key={value} data-checked={preferences.clockSize === value}><input type="radio" name="clock-size" value={value} checked={preferences.clockSize === value} onChange={() => update({ clockSize: value })} />{label}</label>)}</div></div>
          </div>
          <label className={styles.field}>Timer ring width · {preferences.perimeterWidth} px<input type="range" min="3" max="12" step="1" value={preferences.perimeterWidth} onChange={event => update({ perimeterWidth: Number(event.target.value) })} /></label>
          <div className={styles.twoUp}>
            <div className={styles.field}><span>First milestone marker · {seconds(preferences.amberMs)}</span><div className={styles.markerRow}><input type="range" min="5" max="30" step="1" aria-label="First milestone marker" value={preferences.amberMs / 1000} onChange={event => { const amberMs = Number(event.target.value) * 1000; update({ amberMs, redMs: Math.min(preferences.redMs, amberMs) }); }} /><input type="color" aria-label="First milestone colour" value={preferences.markColors.first || themeColor('--phase-amber')} onChange={event => update({ markColors: { ...preferences.markColors, first: event.target.value } })} />{preferences.markColors.first && <button type="button" className={shared.iconButton} aria-label="First milestone colour back to the theme" title="Theme colour" onClick={() => update({ markColors: { ...preferences.markColors, first: '' } })}><Icon name="undo" size={14} /></button>}</div></div>
            <div className={styles.field}><span>Second milestone marker · {seconds(preferences.redMs)}</span><div className={styles.markerRow}><input type="range" min="1" max={Math.min(10, preferences.amberMs / 1000)} step="1" aria-label="Second milestone marker" value={preferences.redMs / 1000} onChange={event => update({ redMs: Number(event.target.value) * 1000 })} /><input type="color" aria-label="Second milestone colour" value={preferences.markColors.second || themeColor('--phase-red')} onChange={event => update({ markColors: { ...preferences.markColors, second: event.target.value } })} />{preferences.markColors.second && <button type="button" className={shared.iconButton} aria-label="Second milestone colour back to the theme" title="Theme colour" onClick={() => update({ markColors: { ...preferences.markColors, second: '' } })}><Icon name="undo" size={14} /></button>}</div></div>
          </div>
          <p className={styles.hint}>Work changes colour at each marker this long before a slot ends; the markers sit on the ring above, in the colours you pick (the theme’s amber and red unless changed). Short slots cap them at a quarter and a tenth of their length, and the spoken countdown stays at three seconds.</p>
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
  return <section className={styles.card} aria-labelledby="sound-title">
    <h2 id="sound-title">Sound and voice</h2>
    <label className={styles.field}>Sound<select value={preferences.soundMode} onChange={event => update({ soundMode: event.target.value as Preferences['soundMode'] })}><option value="voice">Voice + beeps</option><option value="beeps">Beeps only</option><option value="silent">Silent</option></select></label>
    <label className={styles.field}>Voice<select value={preferences.cueSource === 'device' ? 'device' : preferences.cuePack || (packs[0]?.id ?? '')} onChange={event => update(event.target.value === 'device' ? { cueSource: 'device' } : { cueSource: 'clips', cuePack: event.target.value })}>{packs.map(pack => <option key={pack.id} value={pack.id}>{pack.label}</option>)}{packs.length === 0 && <option value="">Recorded voices (not installed in this build)</option>}<option value="device">Device voice only</option></select></label>
    <div className={styles.notes}>
      {preferences.cueSource === 'clips' && clipsReady === false && <small className={shared.fieldNote}>The recorded voices are not installed in this build, so the device voice is used. The Docker image renders them; locally run `npm run cues:generate`.</small>}
      <small className={shared.fieldNote}>Five English voices, three men and two women with British, Scottish, Northern English and American accents, rendered offline with Piper and shipped inside the image. The chosen voice says Go, Rest, the countdown, who is up and every bundled movement. Your own movements are read by the device’s best English voice.</small>
    </div>
    <div className={styles.twoUp}>
      <label className={styles.field}>Device voice speed<input type="range" min="0.7" max="1.3" step="0.1" value={preferences.rate} onChange={event => update({ rate: Number(event.target.value) })} /></label>
      <label className={styles.field}>Volume<input type="range" min="0" max="1" step="0.1" value={preferences.volume} onChange={event => update({ volume: Number(event.target.value) })} /></label>
    </div>
    <div><button type="button" className={shared.quietButton} onClick={() => void audio.test()} disabled={preferences.soundMode === 'silent'}><Icon name="sound" />Test sound</button></div>
  </section>;
}
