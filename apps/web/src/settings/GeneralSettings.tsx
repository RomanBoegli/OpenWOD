import { useEffect, useState } from 'react';
import type { Preferences } from '../preferences';
import { CALIBRATION_RANGES, DEFAULT_CALIBRATION, normaliseCalibration, type DifficultyCalibration } from '../../../../packages/domain/src/difficulty';
import { DifficultyChip } from '../DifficultyChip';
import { downloadUrl } from '../data/client';
import { downloadBlob } from '../download';
import { IDB_VERSION } from '../data/idb';
import { Icon } from '../Icon';
import { accentTokens, DARK_BACKGROUNDS, LIGHT_BACKGROUNDS, neutralTokens, type DarkBackground, type LightBackground, type Theme } from '../theme';
import styles from '../Settings.module.css';
import shared from '../App.module.css';
import { plural, type HouseholdStatus, type SettingsProps } from './shared';
import { RestoreFromBackup, type RestoreMessage } from './RestoreDialog';
import { ColorChoice } from './ColorChoice';

const BACKGROUND_LABELS: Record<DarkBackground | LightBackground, string> = { black: 'Black', deep: 'Deep', grey: 'Grey', white: 'White', paper: 'Paper' };
const BACKGROUND_TIPS: Record<DarkBackground | LightBackground, string> = { black: 'Nearly black, the most contrast', deep: 'The built-in dark tone', grey: 'A softer grey, less contrast', white: 'Plain white, the most contrast', paper: 'The built-in paper tone' };

/** Ready-made accents; the first is the built-in green. Any other colour comes from the picker. */
const ACCENTS: [string, string][] = [['', 'Green'], ['#2a9d8f', 'Teal'], ['#3b82f6', 'Blue'], ['#8b5cf6', 'Violet'], ['#ec4899', 'Pink'], ['#f97316', 'Orange']];
const BUILT_IN_GREEN: Record<Theme, string> = { dark: '#c8ee91', light: '#3f8313' };

/** The shade a theme will actually show for a choice, so the swatch matches the result. */
const shadeOf = (value: string, theme: Theme) => value ? accentTokens(value, theme)[theme === 'dark' ? '--accent' : '--accent-fill'] : BUILT_IN_GREEN[theme];

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
      <ColorChoice id="accent" label="Accent" options={ACCENTS} value={preferences.accent} shade={shadeOf} onChange={accent => update({ accent })} />
      {(['dark', 'light'] as const).map(theme => {
        const options: readonly (DarkBackground | LightBackground)[] = theme === 'dark' ? DARK_BACKGROUNDS : LIGHT_BACKGROUNDS;
        return <div key={theme} className={styles.field}><span id={`background-${theme}-label`}>Background in the {theme} theme</span><div className={shared.segmented} role="radiogroup" aria-labelledby={`background-${theme}-label`}>{options.map(option => <label key={option} data-checked={preferences.background[theme] === option} title={BACKGROUND_TIPS[option]}><input type="radio" name={`background-${theme}`} value={option} checked={preferences.background[theme] === option} onChange={() => update({ background: { ...preferences.background, [theme]: option } })} /><span className={styles.depthDot} style={{ background: neutralTokens(preferences.accent[theme], option, theme)['--bg'] }} aria-hidden="true" />{BACKGROUND_LABELS[option]}</label>)}</div></div>;
      })}
      <p className={styles.hint}>Buttons, links, the work-phase ring and the highlights follow the accent, and the background, the cards and the text greys take a faint tint of it. Background sets how deep the dark theme and how bright the light theme are. Each theme keeps its own choices, shown here in the shades it will use. The colour of rest and transitions is under Training view.</p>
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
    {household.mode === 'static' ? <BrowserCard household={household} /> : <ServerCard household={household} />}
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

function Message({ message }: { message?: RestoreMessage }) {
  return message ? <p className={shared.notice} role={message.tone}>{message.text}</p> : null;
}

/** The household server this app is served from: connection, the SQLite backup, the JSON export and its restore. */
function ServerCard({ household }: { household: HouseholdStatus }) {
  const [message, setMessage] = useState<RestoreMessage>();
  return <section className={styles.card} aria-labelledby="household-title">
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
      <RestoreFromBackup mode="server" disabled={household.connection !== 'online'} onRestore={household.onRestore} onMessage={setMessage} />
      <button type="button" className={shared.quietButton} onClick={() => void household.onRefresh()}><Icon name="undo" size={15} />Reconnect</button>
      {household.legacy && <button type="button" className={shared.quietButton} disabled={household.migrating || household.connection !== 'online'} onClick={() => void household.onMigrate()}><Icon name="upload" size={15} />{household.migrating ? 'Moving…' : 'Move device data to the server'}</button>}
    </div>
    <Message message={message} />
    <p className={styles.hint}>The backup is a consistent copy of the SQLite database, taken with the SQLite backup API while the server keeps running. The export is the same data as JSON: it is not a sharing file, but it restores into any OpenWOD, a household server or a browser.</p>
    <p className={styles.hint}>Restore from backup reads such an export and replaces the household’s whole library with it, for every device. Before it does, the server writes a copy of the current database under /data/backups.</p>
  </section>;
}

interface StorageState { usage?: number; quota?: number; estimated: boolean; persisted?: boolean }
const hasStorage = () => typeof navigator !== 'undefined' && 'storage' in navigator && Boolean(navigator.storage);
const canEstimate = () => hasStorage() && typeof navigator.storage.estimate === 'function';
const canPersist = () => hasStorage() && typeof navigator.storage.persisted === 'function' && typeof navigator.storage.persist === 'function';
const bytes = (value: number) => {
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let amount = value; let unit = 0;
  while (amount >= 1000 && unit < units.length - 1) { amount /= 1000; unit += 1; }
  return unit === 0 ? `${amount} bytes` : `${amount < 10 ? amount.toFixed(1) : Math.round(amount)} ${units[unit]}`;
};
const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };

/** The static shape: the library is this browser's IndexedDB, so the card is about storage and the backup file. */
function BrowserCard({ household }: { household: HouseholdStatus }) {
  const { stats } = household;
  const [storage, setStorage] = useState<StorageState>({ estimated: false });
  const [message, setMessage] = useState<RestoreMessage>();
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: StorageState = { estimated: false };
      if (canEstimate()) { try { const estimate = await navigator.storage.estimate(); next.usage = estimate.usage; next.quota = estimate.quota; next.estimated = true; } catch { /* unknown */ } }
      if (canPersist()) { try { next.persisted = await navigator.storage.persisted(); } catch { /* unknown */ } }
      if (!cancelled) setStorage(next);
    })();
    return () => { cancelled = true; };
  }, [stats]);
  const keep = async () => {
    try {
      const granted = await navigator.storage.persist();
      setStorage(current => ({ ...current, persisted: granted }));
      setMessage(granted ? { text: 'This browser now keeps the library until you clear the site’s data yourself.', tone: 'status' } : { text: 'The browser did not agree this time. Browsers usually agree for an installed app or a site you use often, so try again later, and keep a backup meanwhile.', tone: 'alert' });
    } catch (error) { setMessage({ text: error instanceof Error ? error.message : String(error), tone: 'alert' }); }
  };
  const download = async () => {
    setSaving(true);
    try {
      const document = await household.onExportAll();
      downloadBlob(new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }), `openwod-backup-${today()}.json`);
    } catch (error) { setMessage({ text: `The backup could not be written. ${error instanceof Error ? error.message : String(error)}`, tone: 'alert' }); } finally { setSaving(false); }
  };
  const used = storage.estimated && storage.usage !== undefined ? `${bytes(storage.usage)}${storage.quota ? ` of ${bytes(storage.quota)}` : ''}` : 'Unknown';
  return <section className={styles.card} aria-labelledby="household-title">
    <h2 id="household-title">This browser</h2>
    <p className={styles.hint}>Workouts, collections, movements and the session log live in this browser’s storage (IndexedDB) on this device. Each browser and each browser profile keeps a library of its own, and nothing leaves this device unless you download it.</p>
    <dl className={styles.facts}>
      <div><dt>Storage used</dt><dd>{used}</dd></div>
      {storage.persisted !== undefined && <div><dt>Kept on this device</dt><dd>{storage.persisted ? 'Yes' : 'Not guaranteed'}</dd></div>}
      <div><dt>Library format</dt><dd>Version {household.schemaVersion ?? IDB_VERSION}</dd></div>
      <div><dt>Saved workouts</dt><dd>{stats ? `${stats.workouts}${stats.archived ? ` · ${stats.archived} archived` : ''}` : '—'}</dd></div>
      <div><dt>Sessions</dt><dd>{stats ? stats.sessions : '—'}</dd></div>
    </dl>
    <div className={styles.rowActions}>
      <button type="button" className={shared.quietButton} disabled={saving} onClick={() => void download()}><Icon name="download" size={15} />{saving ? 'Preparing…' : 'Download backup'}</button>
      <RestoreFromBackup mode="static" onRestore={household.onRestore} onMessage={setMessage} />
      {storage.persisted === false && <button type="button" className={shared.quietButton} onClick={() => void keep()}><Icon name="check" size={15} />Keep data on this device</button>}
    </div>
    <Message message={message} />
    <p className={styles.hint}>The backup is one JSON file with the whole library{stats ? ` (${plural(stats.workouts + stats.archived, 'workout')} and ${plural(stats.sessions, 'session')} now)` : ''}. Keep it somewhere safe: clearing this site’s data or removing the browser deletes the library. Restore from backup reads such a file, written here or by any other OpenWOD, and replaces the library here with it.</p>
    {storage.persisted === false && <p className={styles.hint}>Until the browser agrees to keep it, the library may be cleared when the device runs low on space.</p>}
  </section>;
}
