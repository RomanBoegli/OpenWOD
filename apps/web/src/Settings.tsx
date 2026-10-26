import { useMemo, useState } from 'react';
import { CATEGORY_LABELS, MOVEMENT_CATEGORIES, movementSlug, type Catalogue, type Movement, type MovementCategory } from '../../../packages/domain/src/catalogue';
import { collectPrescriptions, equipmentKey, equipmentOptions } from '../../../packages/domain/src/library';
import type { WorkoutAudio } from './audio';
import type { LibraryEntry } from './Library';
import { allCollections, commitMerge, freeMovementId, mergeEquipment, mergeMovements, removeCollection, removeMovement, removeMovementAlias, restoreBundledMovements, seedIds, unmergeEquipment, upsertCollection, upsertMovement, type Collection, type MasterData } from './master-data';
import { recordForName } from './catalogue-link';
import { movementRows } from './settings/movement-rows';
import { Badge, MasterList } from './settings/MasterList';
import { FormDialog } from './settings/FormDialog';
import { TimerPreview } from './settings/TimerPreview';
import { TagPicker } from './TagPicker';
import { equipmentRepertoire } from './equipment';
import { ConfirmDialog } from './ConfirmDialog';
import type { Preferences } from './preferences';
import { SETTINGS_SECTIONS, settingsHref, type SettingsSection } from './router';
import { Chip } from './Chip';
import { Switch } from './Switch';
import { Icon } from './Icon';
import styles from './Settings.module.css';
import shared from './App.module.css';

interface SettingsProps {
  section: SettingsSection;
  preferences: Preferences;
  onPreferencesChange: (update: (value: Preferences) => Preferences) => void;
  masterData: MasterData;
  onMasterDataChange: (update: (value: MasterData) => MasterData) => void;
  catalogue: Catalogue;
  entries: LibraryEntry[];
  clipsReady?: boolean;
  packs: { id: string; label: string }[];
  audio: WorkoutAudio;
}

const SECTION_LABELS: Record<SettingsSection, { title: string; blurb: string }> = {
  general: { title: 'General', blurb: 'Theme, the player’s look, and who trains here.' },
  player: { title: 'Training view', blurb: 'Units, the look of the timer, and the sound.' },
  equipment: { title: 'Equipment', blurb: 'What you own, and one spelling per item across the library.' },
  movements: { title: 'Movements', blurb: 'Every movement the library knows, with its variants and equipment.' },
  collections: { title: 'Collections', blurb: 'Named lists of workouts, shown as chips and as a filter.' },
};

const slug = (title: string) => title.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'collection';

/** Everything about this device and its master data, in sections: general, training view (with sound), equipment, movements, collections. */
export function Settings(props: SettingsProps) {
  const { section } = props;
  return <div className={styles.settings}>
    <div className={shared.workoutHeading}><div><div className={shared.eyebrow}><a href="#/">YOUR LIBRARY</a> <span>/</span> SETTINGS</div><h1>Make it yours</h1><p className={shared.description}>Saved on this device. {SECTION_LABELS[section].blurb}</p></div></div>
    <div className={styles.layout}>
      <nav className={styles.nav} aria-label="Settings sections">
        {SETTINGS_SECTIONS.map(item => <a key={item} href={settingsHref(item)} aria-current={item === section ? 'page' : undefined}>{SECTION_LABELS[item].title}</a>)}
      </nav>
      <div className={styles.content}>
        {section === 'general' && <GeneralSettings {...props} />}
        {section === 'player' && <PlayerSettings {...props} />}
        {section === 'equipment' && <EquipmentSettings {...props} />}
        {section === 'movements' && <MovementSettings {...props} />}
        {section === 'collections' && <CollectionSettings {...props} />}
      </div>
    </div>
  </div>;
}

function GeneralSettings({ preferences, onPreferencesChange }: SettingsProps) {
  const update = (patch: Partial<Preferences>) => onPreferencesChange(value => ({ ...value, ...patch }));
  return <>
    <section className={styles.card} aria-labelledby="appearance-title">
      <h2 id="appearance-title">Appearance</h2>
      <div className={styles.field}><span id="theme-label">Theme</span><div className={shared.segmented} role="radiogroup" aria-labelledby="theme-label">{([['auto', 'Auto', 'auto'], ['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']] as const).map(([value, label, icon]) => <label key={value} data-checked={preferences.theme === value}><input type="radio" name="theme" value={value} checked={preferences.theme === value} onChange={() => update({ theme: value })} /><Icon name={icon} size={16} />{label}</label>)}</div></div>
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
  </>;
}

function PlayerSettings(props: SettingsProps) {
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
        <TimerPreview view={preferences.view} ringWidth={preferences.perimeterWidth} washGain={preferences.wash ? preferences.washGain : 0} amberMs={preferences.amberMs} redMs={preferences.redMs} colors={preferences.markColors} />
        <div className={styles.previewFields}>
          <label className={styles.field}>Default view<select value={preferences.view} onChange={event => update({ view: event.target.value as Preferences['view'] })}><option value="focus">Focus</option><option value="context">Context</option></select></label>
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

function SoundSettings({ preferences, onPreferencesChange, clipsReady, packs, audio }: SettingsProps) {
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

function EquipmentSettings({ preferences, onPreferencesChange, masterData, onMasterDataChange, entries }: SettingsProps) {
  const update = (patch: Partial<Preferences>) => onPreferencesChange(value => ({ ...value, ...patch }));
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<string[]>([]);
  const [mergeTarget, setMergeTarget] = useState('');
  const [renaming, setRenaming] = useState<{ from: string; to: string }>();
  // Equipment as the library sees it after merges, with how many workouts need each item.
  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries) for (const item of entry.summary.equipmentNeeded) counts.set(equipmentKey(item), (counts.get(equipmentKey(item)) ?? 0) + 1);
    return counts;
  }, [entries]);
  const names = useMemo(() => equipmentOptions(entries.map(entry => entry.summary)), [entries]);
  const visible = names.filter(name => !query.trim() || name.toLowerCase().includes(query.trim().toLowerCase()));
  const merges = Object.entries(masterData.equipmentAliases).filter(([key, name]) => key !== equipmentKey(name) && !masterData.committed.includes(`equipment:${key}`));
  const owned = (name: string) => preferences.myEquipment.includes(name);
  const setOwned = (name: string, have: boolean) => update({ myEquipment: have ? [...preferences.myEquipment.filter(item => item !== name), name] : preferences.myEquipment.filter(item => item !== name) });
  const merge = () => {
    const target = mergeTarget.trim() || selection[0];
    if (!target || selection.length < 2) return;
    onMasterDataChange(data => mergeEquipment(data, selection, target));
    if (selection.some(owned)) update({ myEquipment: [...preferences.myEquipment.filter(item => !selection.includes(item)), target] });
    setSelection([]); setMergeTarget('');
  };
  const rename = () => {
    if (!renaming) return;
    const to = renaming.to.trim();
    if (to && to !== renaming.from) {
      onMasterDataChange(data => mergeEquipment(data, [renaming.from], to));
      if (owned(renaming.from)) update({ myEquipment: preferences.myEquipment.map(item => item === renaming.from ? to : item) });
    }
    setRenaming(undefined);
  };
  return <>
    <section className={styles.card} aria-labelledby="equipment-title">
      <div className={styles.cardHeading}><h2 id="equipment-title">Equipment</h2><span className={styles.hint}>{names.length} items · {preferences.myEquipment.length} at home</span></div>
      <p className={styles.hint}>Tick what you have at home; the library’s “Only my equipment” filter then shows workouts that need nothing more. Rename an item, or tick two or more and merge them into one spelling used on every card, overview and filter.</p>
      <div className={styles.listTop}><label className={`${styles.field} ${styles.search}`}>Find<input type="search" value={query} placeholder="ball, bar, rower…" aria-label="Find equipment" onChange={event => setQuery(event.target.value)} /></label></div>
      {selection.length >= 2 && <div className={styles.mergeBar} role="group" aria-label="Merge selected equipment">
        <span>{selection.length} selected</span>
        <label className={styles.field}>Keep as<input value={mergeTarget} placeholder={selection[0]} list="equipment-names" aria-label="Keep as" onChange={event => setMergeTarget(event.target.value)} /></label>
        <datalist id="equipment-names">{names.map(item => <option key={item} value={item} />)}</datalist>
        <button type="button" className={shared.primaryButton} onClick={merge}><Icon name="check" />Merge {selection.length}</button>
        <button type="button" className={shared.quietButton} onClick={() => setSelection([])}>Clear</button>
      </div>}
      <MasterList label="Equipment in the library" selectable actionsWidth="110px" empty={`Nothing matches “${query}”.`}
        columns={[{ key: 'name', caption: 'Name' }, { key: 'usage', caption: 'Workouts', width: '90px', align: 'end' }, { key: 'owned', caption: 'I have it', width: '80px' }]}
        rows={visible.map(name => ({
          id: name,
          cells: { name: <strong>{name}</strong>, usage: usage.get(equipmentKey(name)) ?? 0, owned: <input type="checkbox" checked={owned(name)} aria-label={`I have ${name}`} onChange={event => setOwned(name, event.target.checked)} /> },
          select: { checked: selection.includes(name), label: `Select ${name}`, onChange: checked => setSelection(current => checked ? [...current, name] : current.filter(item => item !== name)) },
          actions: <button type="button" className={shared.quietButton} aria-label={`Rename ${name}`} onClick={() => setRenaming({ from: name, to: name })}><Icon name="edit" size={14} />Rename</button>,
        }))} />
      {merges.length > 0 && <ul className={styles.merges} aria-label="Merged names">{merges.map(([key, name]) => <li key={key}><span>{key} → <strong>{name}</strong></span><span className={styles.rowActions}><button type="button" className={shared.quietButton} onClick={() => onMasterDataChange(data => unmergeEquipment(data, key))}><Icon name="undo" size={14} />Undo</button><button type="button" className={shared.quietButton} title="Keep this for good and drop it from the list" aria-label={`Commit ${key}`} onClick={() => onMasterDataChange(data => commitMerge(data, `equipment:${key}`))}><Icon name="check" size={14} />Commit</button></span></li>)}</ul>}
    </section>
    <FormDialog open={Boolean(renaming)} title={`Rename ${renaming?.from ?? ''}`} submitLabel="Rename" disabled={!renaming?.to.trim()} onSubmit={rename} onClose={() => setRenaming(undefined)}>
      <label>Name<input value={renaming?.to ?? ''} maxLength={80} onChange={event => setRenaming(current => current && { ...current, to: event.target.value })} /></label>
      <p className={shared.fieldNote}>Every workout that names “{renaming?.from}” shows the new spelling; the file text is not changed.</p>
    </FormDialog>
  </>;
}

type MovementForm = { id?: string; name: string; shortName: string; spokenName: string; aliases: string; family: string; category: '' | MovementCategory; equipment: string[]; notes: string };
const emptyForm = (): MovementForm => ({ name: '', shortName: '', spokenName: '', aliases: '', family: '', category: '', equipment: [], notes: '' });
const toForm = (record: Movement): MovementForm => ({ id: record.id, name: record.name, shortName: record.shortName ?? '', spokenName: record.spokenName ?? '', aliases: (record.aliases ?? []).join(', '), family: record.family ?? '', category: record.category ?? '', equipment: [...(record.equipment ?? [])], notes: record.notes ?? '' });
const list = (text: string) => text.split(',').map(item => item.trim()).filter(Boolean);
const plural = (count: number, noun: string) => `${count} ${count === 1 ? noun : `${noun}s`}`;

function MovementSettings({ masterData, onMasterDataChange, catalogue, entries }: SettingsProps) {
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<string[]>([]);
  const [mergeTarget, setMergeTarget] = useState('');
  const [form, setForm] = useState<MovementForm>();
  const [removing, setRemoving] = useState<Movement>();
  const [restoring, setRestoring] = useState(false);
  const equipmentChoices = useMemo(() => equipmentRepertoire(catalogue, entries.map(entry => entry.summary)), [catalogue, entries]);
  // How many library workouts use each record, and the names no record knows.
  const { usage, unknown } = useMemo(() => {
    const usage = new Map<string, number>();
    const unknown = new Map<string, number>();
    for (const entry of entries) for (const prescription of collectPrescriptions(entry.workout)) {
      const record = catalogue.resolve(prescription);
      if (record) usage.set(record.id, (usage.get(record.id) ?? 0) + 1);
      else unknown.set(prescription.name, (unknown.get(prescription.name) ?? 0) + 1);
    }
    return { usage, unknown: [...unknown.entries()].sort((a, b) => a[0].localeCompare(b[0], 'en')) };
  }, [entries, catalogue]);
  const heads = useMemo(() => catalogue.records.filter(record => !record.family), [catalogue]);
  const rows = useMemo(() => movementRows(catalogue, query), [catalogue, query]);
  const selectedRecords = selection.map(id => catalogue.get(id)).filter((record): record is Movement => Boolean(record));
  const customised = masterData.movements.length + masterData.hiddenMovements.length + Object.keys(masterData.movementAliases).length;

  const save = () => {
    if (!form || !form.name.trim()) return;
    const id = form.id ?? freeMovementId(movementSlug(form.name), catalogue);
    const record: Movement = { id, name: form.name.trim() };
    if (form.shortName.trim()) record.shortName = form.shortName.trim();
    if (form.spokenName.trim()) record.spokenName = form.spokenName.trim();
    if (list(form.aliases).length) record.aliases = list(form.aliases);
    if (form.family && form.family !== id) record.family = form.family;
    if (form.category) record.category = form.category;
    if (form.equipment.length) record.equipment = form.equipment;
    if (form.notes.trim()) record.notes = form.notes.trim();
    onMasterDataChange(data => upsertMovement(data, record));
    setForm(undefined);
  };
  const merge = () => {
    const target = mergeTarget || selection[0];
    if (!target || selection.length < 2) return;
    onMasterDataChange(data => mergeMovements(data, selection, target));
    setSelection([]); setMergeTarget('');
  };
  const addUnknown = (names: string[]) => onMasterDataChange(data => { let next = data; for (const name of names) next = upsertMovement(next, recordForName(name, catalogue, [])); return next; });
  const consequences = (record: Movement) => [
    usage.get(record.id) ? `${plural(usage.get(record.id)!, 'workout')} name it; their text keeps the name and shows as unknown.` : 'No workout in your library names it.',
    catalogue.variants(record.id).length ? `${plural(catalogue.variants(record.id).length, 'variant')} move up to stand alone.` : '',
    seedIds.has(record.id) ? 'It is a bundled record: hidden, not deleted. Restore the bundled movements brings it back.' : '',
  ].filter(Boolean).join(' ');

  return <>
    {unknown.length > 0 && <section className={styles.card} data-tone="notice" aria-labelledby="unknown-title">
      <h2 id="unknown-title">Not in your catalogue yet</h2>
      <p className={styles.hint}>Movements written in library workouts that no record matches. Add them as they are, or rename a record so its name or an alias matches.</p>
      <ul className={styles.unknownList} aria-label="Movements without a record">{unknown.map(([name, count]) => <li key={name}><span>{name}</span><small>{plural(count, 'workout')}</small><button type="button" className={shared.quietButton} onClick={() => addUnknown([name])} aria-label={`Add ${name}`}><Icon name="plus" size={14} />Add</button></li>)}</ul>
      {unknown.length > 1 && <div><button type="button" className={shared.quietButton} onClick={() => addUnknown(unknown.map(([name]) => name))}><Icon name="plus" size={14} />Add all {unknown.length}</button></div>}
    </section>}

    <section className={styles.card} aria-labelledby="movements-title">
      <div className={styles.cardHeading}><h2 id="movements-title">Movements</h2><span className={styles.hint}>{catalogue.records.length} records{customised ? ` · ${plural(customised, 'change')} of yours` : ''}</span></div>
      <p className={styles.hint}>Variants sit under their family (Hang power cleans under Cleans). Tick two or more to merge them; every merged name keeps resolving to the one you keep.</p>
      <div className={styles.listTop}>
        <label className={`${styles.field} ${styles.search}`}>Find<input type="search" value={query} placeholder="thruster, clean, kettlebell…" aria-label="Find movements" onChange={event => setQuery(event.target.value)} /></label>
        <button type="button" className={shared.primaryButton} onClick={() => setForm(emptyForm())}><Icon name="plus" size={16} />New movement</button>
      </div>
      {selection.length >= 2 && <div className={styles.mergeBar} role="group" aria-label="Merge selected movements">
        <span>{selection.length} selected</span>
        <label className={styles.field}>Keep<select value={mergeTarget || selection[0]} aria-label="Keep as" onChange={event => setMergeTarget(event.target.value)}>{selectedRecords.map(record => <option key={record.id} value={record.id}>{record.name}</option>)}</select></label>
        <button type="button" className={shared.primaryButton} onClick={merge}><Icon name="check" />Merge {selection.length}</button>
        <button type="button" className={shared.quietButton} onClick={() => setSelection([])}>Clear</button>
      </div>}
      <MasterList label="Movements" selectable actionsWidth="124px" empty={`Nothing matches “${query}”.`}
        columns={[{ key: 'name', caption: 'Movement', width: 'minmax(180px, 1.3fr)' }, { key: 'equipment', caption: 'Equipment', width: 'minmax(0, 1fr)' }, { key: 'usage', caption: 'Workouts', width: '80px', align: 'end' }]}
        rows={rows.map(({ record, variant, muted }) => ({
          id: record.id, indent: variant, muted,
          cells: {
            name: <><strong>{record.name}</strong>{!seedIds.has(record.id) && <Badge tone="accent">yours</Badge>}<small>{[record.shortName ? `short: ${record.shortName}` : '', record.aliases?.length ? `also ${record.aliases.join(', ')}` : '', record.category ? CATEGORY_LABELS[record.category] : ''].filter(Boolean).join(' · ')}</small></>,
            equipment: <span className={styles.chipRow}>{(record.equipment ?? []).map(item => <Chip key={item} kind="neutral">{item}</Chip>)}{!record.equipment?.length && <Chip kind="neutral">Bodyweight</Chip>}</span>,
            usage: usage.get(record.id) ?? 0,
          },
          select: { checked: selection.includes(record.id), label: `Select ${record.name}`, onChange: checked => setSelection(current => checked ? [...current, record.id] : current.filter(id => id !== record.id)) },
          actions: <>
            <button type="button" className={shared.quietButton} onClick={() => setForm(toForm(record))} aria-label={`Edit ${record.name}`}><Icon name="edit" size={14} />Edit</button>
            <button type="button" className={shared.quietButton} onClick={() => setRemoving(record)} aria-label={`Remove ${record.name}`}><Icon name="trash" size={14} /></button>
          </>,
        }))} />
      {Object.entries(masterData.movementAliases).some(([spelling]) => !masterData.committed.includes(`movement:${spelling}`)) && <ul className={styles.merges} aria-label="Merged movement names">{Object.entries(masterData.movementAliases).filter(([spelling]) => !masterData.committed.includes(`movement:${spelling}`)).map(([spelling, id]) => <li key={spelling}><span>{spelling} → <strong>{catalogue.get(id)?.name ?? id}</strong></span><span className={styles.rowActions}><button type="button" className={shared.quietButton} onClick={() => onMasterDataChange(data => removeMovementAlias(data, spelling))}><Icon name="undo" size={14} />Undo</button><button type="button" className={shared.quietButton} title="Keep this for good and drop it from the list" aria-label={`Commit ${spelling}`} onClick={() => onMasterDataChange(data => commitMerge(data, `movement:${spelling}`))}><Icon name="check" size={14} />Commit</button></span></li>)}</ul>}
      {customised > 0 && <div><button type="button" className={shared.quietButton} onClick={() => setRestoring(true)}>Restore the bundled movements</button></div>}
    </section>

    <FormDialog open={Boolean(form)} wide title={form?.id ? `Edit ${catalogue.get(form.id)?.name ?? 'movement'}` : 'New movement'} submitLabel={form?.id ? 'Save movement' : 'Add movement'} disabled={!form?.name.trim()} onSubmit={save} onClose={() => setForm(undefined)}>
      {form && <div className={styles.formGrid}>
        <label className={styles.field}>Name<input value={form.name} maxLength={160} placeholder="Hang power cleans" onChange={event => setForm({ ...form, name: event.target.value })} /></label>
        <label className={styles.field}>Family<select value={form.family} onChange={event => setForm({ ...form, family: event.target.value })}><option value="">None (stands alone)</option>{heads.filter(head => head.id !== form.id).map(head => <option key={head.id} value={head.id}>{head.name}</option>)}</select></label>
        <label className={styles.field}>Short name<input value={form.shortName} maxLength={60} placeholder="HPC" onChange={event => setForm({ ...form, shortName: event.target.value })} /></label>
        <label className={styles.field}>Spoken name<input value={form.spokenName} maxLength={160} placeholder="hang power cleans" onChange={event => setForm({ ...form, spokenName: event.target.value })} /></label>
        <label className={styles.field}>Also known as<input value={form.aliases} maxLength={500} placeholder="HPC, hang power clean" onChange={event => setForm({ ...form, aliases: event.target.value })} /></label>
        <label className={styles.field}>Category<select value={form.category} onChange={event => setForm({ ...form, category: event.target.value as MovementForm['category'] })}><option value="">Unset</option>{MOVEMENT_CATEGORIES.map(category => <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>)}</select></label>
        <div className={styles.field}><span>Equipment</span><TagPicker label="Equipment" value={form.equipment} options={equipmentChoices} placeholder="Barbell, Pull-up bar…" onChange={equipment => setForm({ ...form, equipment })} /></div>
        <label className={`${styles.field} ${styles.wide}`}>Notes<input value={form.notes} maxLength={500} placeholder="Standards, scaling, cues" onChange={event => setForm({ ...form, notes: event.target.value })} /></label>
      </div>}
    </FormDialog>
    <ConfirmDialog open={Boolean(removing)} title={`Remove ${removing?.name ?? ''}?`} confirmLabel="Remove" cancelLabel="Keep it" onConfirm={() => { if (removing) onMasterDataChange(data => removeMovement(data, removing.id)); setRemoving(undefined); }} onClose={() => setRemoving(undefined)}>
      <p>{removing && consequences(removing)}</p>
    </ConfirmDialog>
    <ConfirmDialog open={restoring} title="Restore the bundled movements?" confirmLabel="Restore" cancelLabel="Keep my changes" onConfirm={() => { onMasterDataChange(restoreBundledMovements); setRestoring(false); }} onClose={() => setRestoring(false)}>
      <p>Edits to bundled records, removals and merged names are dropped. Movements you added yourself stay.</p>
    </ConfirmDialog>
  </>;
}

type CollectionForm = { id?: string; title: string; description: string; workoutIds: string[] };

function CollectionSettings({ masterData, onMasterDataChange, entries }: SettingsProps) {
  const [form, setForm] = useState<CollectionForm>();
  const [removing, setRemoving] = useState<Collection>();
  const [search, setSearch] = useState('');
  const collections = allCollections(masterData);
  const save = () => {
    if (!form) return;
    const title = form.title.trim();
    if (!title) return;
    const id = form.id ?? (() => { const base = slug(title); let candidate = base; for (let n = 2; collections.some(item => item.id === candidate); n++) candidate = `${base}-${n}`; return candidate; })();
    onMasterDataChange(data => upsertCollection(data, { id, title, ...(form.description.trim() ? { description: form.description.trim() } : {}), workoutIds: form.workoutIds }));
    setForm(undefined);
  };
  const open = (collection?: Collection) => { setSearch(''); setForm(collection ? { id: collection.id, title: collection.title, description: collection.description ?? '', workoutIds: [...collection.workoutIds] } : { title: '', description: '', workoutIds: [] }); };
  const visibleWorkouts = entries.filter(entry => !search.trim() || entry.summary.title.toLowerCase().includes(search.toLowerCase()));
  return <>
    <section className={styles.card} aria-labelledby="collections-title">
      <div className={styles.cardHeading}><h2 id="collections-title">Collections</h2><span className={styles.hint}>{collections.length} collections</span></div>
      <p className={styles.hint}>Named lists of workouts, shown in the corner of each card and as a filter. A workout belongs to one collection at a time; adding it to another moves it. The collections that come with the app can be edited but not removed; make your own beside them.</p>
      <div className={styles.listTop}><span /><button type="button" className={shared.primaryButton} onClick={() => open()}><Icon name="plus" size={16} />New collection</button></div>
      <MasterList label="Collections" actionsWidth="124px" empty="No collections yet."
        columns={[{ key: 'title', caption: 'Collection' }, { key: 'count', caption: 'Workouts', width: '90px', align: 'end' }]}
        rows={collections.map(collection => ({
          id: collection.id,
          cells: { title: <><strong>{collection.title}</strong>{collection.description && <small>{collection.description}</small>}</>, count: collection.workoutIds.length },
          actions: <>
            <button type="button" className={shared.quietButton} aria-label={`Edit collection ${collection.title}`} onClick={() => open(collection)}><Icon name="edit" size={14} />Edit</button>
            {!collection.builtIn && <button type="button" className={shared.quietButton} aria-label={`Remove collection ${collection.title}`} onClick={() => setRemoving(collection)}><Icon name="trash" size={14} /></button>}
          </>,
        }))} />
    </section>
    <FormDialog open={Boolean(form)} wide title={form?.id ? `Edit ${collections.find(item => item.id === form.id)?.title ?? 'collection'}` : 'New collection'} submitLabel={form?.id ? 'Save collection' : 'Create collection'} disabled={!form?.title.trim()} onSubmit={save} onClose={() => setForm(undefined)}>
      {form && <>
        <div className={styles.formGrid}>
          <label className={styles.field}>Title<input value={form.title} maxLength={120} placeholder="Tuesday favourites" onChange={event => setForm({ ...form, title: event.target.value })} /></label>
          <label className={styles.field}>Description<input value={form.description} maxLength={500} placeholder="Optional, shown under the title" onChange={event => setForm({ ...form, description: event.target.value })} /></label>
          <label className={`${styles.field} ${styles.wide}`}>Find workouts<input type="search" value={search} placeholder="Filter by title" onChange={event => setSearch(event.target.value)} /></label>
        </div>
        <div className={styles.chipRow} role="group" aria-label="Workouts in this collection">{visibleWorkouts.map(entry => <Chip key={entry.workout.id} kind="neutral" pressed={form.workoutIds.includes(entry.workout.id)} onClick={() => setForm({ ...form, workoutIds: form.workoutIds.includes(entry.workout.id) ? form.workoutIds.filter(id => id !== entry.workout.id) : [...form.workoutIds, entry.workout.id] })}>{entry.summary.title}</Chip>)}</div>
        <p className={shared.fieldNote}>{plural(form.workoutIds.length, 'workout')} selected</p>
      </>}
    </FormDialog>
    <ConfirmDialog open={Boolean(removing)} title={`Remove ${removing?.title ?? ''}?`} confirmLabel="Remove" cancelLabel="Keep it" onConfirm={() => { if (removing) onMasterDataChange(data => removeCollection(data, removing.id)); setRemoving(undefined); }} onClose={() => setRemoving(undefined)}>
      <p>The collection disappears from cards and filters. Its {plural(removing?.workoutIds.length ?? 0, 'workout')} stay in the library.</p>
    </ConfirmDialog>
  </>;
}
