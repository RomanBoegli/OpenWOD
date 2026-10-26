import type { Preferences } from '../preferences';
import { CALIBRATION_RANGES, DEFAULT_CALIBRATION, normaliseCalibration, type DifficultyCalibration } from '../../../../packages/domain/src/difficulty';
import { DifficultyChip } from '../DifficultyChip';
import { downloadUrl } from '../data/client';
import { Icon } from '../Icon';
import styles from '../Settings.module.css';
import shared from '../App.module.css';
import { type SettingsProps } from './shared';

/** Ready-made accents; the first is the built-in green. Any other colour comes from the picker. */
const ACCENTS: [string, string][] = [['', 'Green'], ['#2a9d8f', 'Teal'], ['#3b82f6', 'Blue'], ['#8b5cf6', 'Violet'], ['#ec4899', 'Pink'], ['#f97316', 'Orange']];

/** Bundled sessions that span the scale, so a change to the knobs is visible at once. */
const REFERENCE_IDS = ['tabata-this', 'cindy', 'fran', 'fight-gone-bad', 'murph', 'hyrox-engine-emom-24'];

export function GeneralSettings({ preferences, onPreferencesChange, entries, household }: SettingsProps) {
  const update = (patch: Partial<Preferences>) => onPreferencesChange(value => ({ ...value, ...patch }));
  const calibration = preferences.difficulty;
  const calibrate = (patch: Partial<DifficultyCalibration>) => update({ difficulty: normaliseCalibration({ ...calibration, ...patch }) });
  const references = REFERENCE_IDS.map(id => entries.find(entry => entry.workout.id === id)).filter(entry => entry !== undefined);
  const isDefault = JSON.stringify(calibration) === JSON.stringify(DEFAULT_CALIBRATION);
  return <>
    <section className={styles.card} aria-labelledby="appearance-title">
      <h2 id="appearance-title">Appearance</h2>
      <div className={styles.field}><span id="theme-label">Theme</span><div className={shared.segmented} role="radiogroup" aria-labelledby="theme-label">{([['auto', 'Auto', 'auto'], ['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']] as const).map(([value, label, icon]) => <label key={value} data-checked={preferences.theme === value}><input type="radio" name="theme" value={value} checked={preferences.theme === value} onChange={() => update({ theme: value })} /><Icon name={icon} size={16} />{label}</label>)}</div></div>
      <div className={styles.field}><span id="accent-label">Accent colour</span>
        <div className={styles.swatches} role="group" aria-labelledby="accent-label">
          {ACCENTS.map(([value, label]) => <button key={label} type="button" className={styles.swatch} style={value ? { background: value } : undefined} data-default={value === '' || undefined} aria-label={label} aria-pressed={preferences.accent === value} title={label} onClick={() => update({ accent: value })} />)}
          <label className={styles.swatchPicker} title="Any colour"><input type="color" aria-label="Custom accent colour" value={preferences.accent || '#c8ee91'} onChange={event => update({ accent: event.target.value.toLowerCase() })} /><span>Custom</span></label>
        </div>
      </div>
      <p className={styles.hint}>Buttons, links, the work-phase ring and the highlights follow this colour. Both themes derive their own shade from it.</p>
    </section>
    <section className={styles.card} aria-labelledby="athletes-title">
      <h2 id="athletes-title">Athletes</h2>
      <p className={styles.hint}>A stays on the left, B on the right. In a pair workout each lane shows its athlete’s load; solo workouts show the men’s amount with the women’s in brackets.</p>
      {(['A', 'B'] as const).map(role => <div key={role} className={styles.athleteRow}>
        <label className={styles.field}>Athlete {role}<input maxLength={30} value={preferences.names[role]} onChange={event => update({ names: { ...preferences.names, [role]: event.target.value } })} /></label>
        <div className={styles.field}><span id={`loads-${role}-label`}>Loads shown for</span><div className={shared.segmented} data-two role="radiogroup" aria-labelledby={`loads-${role}-label`}>{(['men', 'women'] as const).map(sex => <label key={sex} data-checked={preferences.loadsFor[role] === sex}><input type="radio" name={`loads-${role}`} value={sex} checked={preferences.loadsFor[role] === sex} onChange={() => update({ loadsFor: { ...preferences.loadsFor, [role]: sex } })} />{sex === 'men' ? 'Men' : 'Women'}</label>)}</div></div>
      </div>)}
      <p className={styles.hint}>Switching tabs pauses a running workout. Keep the window visible while training.</p>
    </section>
    <section className={styles.card} aria-labelledby="household-title">
      <h2 id="household-title">Household server</h2>
      <p className={styles.hint}>Workouts, collections, movements and the session log live on the server this app is served from, so every device in the household sees the same library. This device keeps a copy for offline reading and uploads changes when the server is back.</p>
      <dl className={styles.facts}>
        <div><dt>Connection</dt><dd>{household.connection === 'online' ? 'Connected' : household.connection === 'offline' ? 'Offline' : household.connection === 'unreachable' ? 'Server unreachable' : 'Checking…'}</dd></div>
        <div><dt>Server</dt><dd>{household.serverVersion ? `OpenWOD ${household.serverVersion}` : '—'}</dd></div>
        <div><dt>Database schema</dt><dd>{household.schemaVersion ?? '—'}</dd></div>
        <div><dt>Waiting to upload</dt><dd>{household.pendingCount}</dd></div>
      </dl>
      <div className={styles.rowActions}>
        <a className={shared.quietButton} href={downloadUrl('/backup')} download><Icon name="download" size={15} />Download backup</a>
        <a className={shared.quietButton} href={downloadUrl('/export')} download><Icon name="download" size={15} />Export all data</a>
        <button type="button" className={shared.quietButton} onClick={() => void household.onRefresh()}><Icon name="undo" size={15} />Reconnect</button>
        {household.legacy && <button type="button" className={shared.quietButton} disabled={household.migrating || household.connection !== 'online'} onClick={() => void household.onMigrate()}><Icon name="upload" size={15} />{household.migrating ? 'Moving…' : 'Move device data to the server'}</button>}
      </div>
      <p className={styles.hint}>The backup is a consistent copy of the SQLite database, taken with the SQLite backup API while the server keeps running. The export is the same data as JSON for reading elsewhere; it is not a sharing file.</p>
    </section>
    <section className={styles.card} aria-labelledby="difficulty-title">
      <h2 id="difficulty-title">Difficulty rating</h2>
      <p className={styles.hint}>Every workout is scored from 0 to 100 on its specification alone: how demanding its movements are and how little rest surrounds them (effort), how long it runs (length) and whether loads are prescribed. Pieces shorter than the full-effort mark are discounted, so two minutes of anything stays Light. Move the knobs until the reference workouts read the way you feel them.</p>
      <div className={styles.twoUp}>
        <label className={styles.field}><span>Full effort from · {calibration.fullEffortMinutes} min</span><input type="range" aria-label="Full effort from" min={CALIBRATION_RANGES.fullEffortMinutes[0]} max={CALIBRATION_RANGES.fullEffortMinutes[1]} step="1" value={calibration.fullEffortMinutes} onChange={event => calibrate({ fullEffortMinutes: Number(event.target.value) })} /></label>
        <label className={styles.field}><span>Longest session · {calibration.longMinutes} min</span><input type="range" aria-label="Longest session" min={CALIBRATION_RANGES.longMinutes[0]} max={CALIBRATION_RANGES.longMinutes[1]} step="5" value={calibration.longMinutes} onChange={event => calibrate({ longMinutes: Number(event.target.value) })} /></label>
      </div>
      <div className={styles.threeUp}>
        {([['effort', 'Effort weight'], ['duration', 'Length weight'], ['load', 'Load weight']] as const).map(([key, label]) => <label key={key} className={styles.field}><span>{label} · {calibration.weights[key]}</span><input type="range" aria-label={label} min={CALIBRATION_RANGES.weight[0]} max={CALIBRATION_RANGES.weight[1]} step="5" value={calibration.weights[key]} onChange={event => calibrate({ weights: { ...calibration.weights, [key]: Number(event.target.value) } })} /></label>)}
      </div>
      <div className={styles.threeUp}>
        {([['moderate', 'Moderate from'], ['hard', 'Hard from'], ['brutal', 'Brutal from']] as const).map(([key, label]) => <label key={key} className={styles.field}><span>{label} · {calibration.thresholds[key]}</span><input type="range" aria-label={label} min={CALIBRATION_RANGES.threshold[0]} max={CALIBRATION_RANGES.threshold[1]} step="1" value={calibration.thresholds[key]} onChange={event => calibrate({ thresholds: { ...calibration.thresholds, [key]: Number(event.target.value) } })} /></label>)}
      </div>
      <div className={styles.field}><span>Reference workouts</span>
        <ul className={styles.references} aria-label="Reference workouts">{references.map(entry => <li key={entry.workout.id}><span>{entry.summary.title}</span><DifficultyChip difficulty={entry.summary.difficulty} detailed /></li>)}</ul>
      </div>
      <div><button type="button" className={shared.quietButton} disabled={isDefault} onClick={() => update({ difficulty: DEFAULT_CALIBRATION })}><Icon name="undo" size={14} />Reset to defaults</button></div>
    </section>
  </>;
}
