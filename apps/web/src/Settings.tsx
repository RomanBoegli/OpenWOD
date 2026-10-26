import { useMemo, useState } from 'react';
import { CATEGORY_LABELS, MOVEMENT_CATEGORIES, movementSlug, type Catalogue, type Movement, type MovementCategory } from '../../../packages/domain/src/catalogue';
import { collectPrescriptions, equipmentKey, equipmentOptions } from '../../../packages/domain/src/library';
import { LOAD_LEVELS } from '../../../packages/domain/src/schema';
import { rankBySearch } from '../../../packages/domain/src/search';
import type { WorkoutAudio } from './audio';
import type { LibraryEntry } from './Library';
import { allCollections, freeMovementId, mergeEquipment, mergeMovements, removeCollection, removeMovement, removeMovementAlias, seedIds, unmergeEquipment, upsertCollection, upsertMovement, type Collection, type MasterData, type MovementLoads, type Sex } from './master-data';
import { recordForName } from './catalogue-link';
import { movementSearchFields } from './MovementPicker';
import type { Preferences } from './preferences';
import { SETTINGS_SECTIONS, settingsHref, type SettingsSection } from './router';
import { LEVEL_LETTERS } from './LevelChip';
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
  sound: { title: 'Sound', blurb: 'Beeps and the recorded voices.' },
  equipment: { title: 'Equipment', blurb: 'What you own, and one spelling per item across the library.' },
  exercises: { title: 'Exercises', blurb: 'Every movement the library knows, with its variants, equipment and default loads.' },
  collections: { title: 'Collections', blurb: 'Named lists of workouts, shown as chips and as a filter.' },
};

const slug = (title: string) => title.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'collection';
const emptyLoads = (): MovementLoads => ({ unit: 'kg', men: { light: 0, medium: 0, heavy: 0 }, women: { light: 0, medium: 0, heavy: 0 } });
const hasLoads = (loads?: MovementLoads) => Boolean(loads && (Object.values(loads.men).some(Boolean) || Object.values(loads.women).some(Boolean)));
const loadsText = (loads: MovementLoads) => `${loads.men.light || '–'} / ${loads.men.medium || '–'} / ${loads.men.heavy || '–'} · ${loads.women.light || '–'} / ${loads.women.medium || '–'} / ${loads.women.heavy || '–'} ${loads.unit}`;

/** Everything about this device and its master data, in sections: general, sound, equipment, exercises, collections. */
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
        {section === 'sound' && <SoundSettings {...props} />}
        {section === 'equipment' && <EquipmentSettings {...props} />}
        {section === 'exercises' && <ExerciseSettings {...props} />}
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
      <label className={styles.field}>Default player view<select value={preferences.view} onChange={event => update({ view: event.target.value as Preferences['view'] })}><option value="focus">Focus</option><option value="context">Context</option></select></label>
      <Switch checked={preferences.wash} onChange={wash => update({ wash })} label="Background pulse" hint="The phase colour tints the whole player and deepens as the clock drains." />
    </section>
    <section className={styles.card} aria-labelledby="athletes-title">
      <h2 id="athletes-title">Athletes</h2>
      <p className={styles.hint}>A stays on the left, B on the right. Default loads from your exercises follow each athlete’s choice; a workout’s own levels are always shown as written.</p>
      {(['A', 'B'] as const).map(role => <div key={role} className={styles.athleteRow}>
        <label className={styles.field}>Athlete {role}<input maxLength={30} value={preferences.names[role]} onChange={event => update({ names: { ...preferences.names, [role]: event.target.value } })} /></label>
        <div className={styles.field}><span id={`loads-${role}-label`}>Shows loads for</span><div className={shared.segmented} data-two role="radiogroup" aria-labelledby={`loads-${role}-label`}>{(['men', 'women'] as const).map(sex => <label key={sex} data-checked={preferences.loadsFor[role] === sex}><input type="radio" name={`loads-${role}`} value={sex} checked={preferences.loadsFor[role] === sex} onChange={() => update({ loadsFor: { ...preferences.loadsFor, [role]: sex } })} />{sex === 'men' ? 'Men' : 'Women'}</label>)}</div></div>
      </div>)}
      <p className={styles.hint}>Switching tabs pauses a running workout. Keep the window visible while training.</p>
    </section>
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
      <small className={shared.fieldNote}>Five English voices, three men and two women with British, Scottish, Northern English and American accents, rendered offline with Piper and shipped inside the image. The chosen voice says Go, Rest, the countdown, who is up and every bundled movement. Your own exercises are read by the device’s best English voice.</small>
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
  const [mergeSelection, setMergeSelection] = useState<string[]>([]);
  const [mergeTarget, setMergeTarget] = useState('');
  // Equipment as the library sees it after merges, with how many workouts need each item.
  const equipmentUsage = useMemo(() => {
    const counts = new Map<string, { name: string; count: number }>();
    for (const entry of entries) for (const item of entry.summary.equipmentNeeded) { const key = equipmentKey(item); counts.set(key, { name: item, count: (counts.get(key)?.count ?? 0) + 1 }); }
    return [...counts.values()].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  }, [entries]);
  const equipmentChoices = useMemo(() => equipmentOptions(entries.map(entry => entry.summary)), [entries]);
  const merges = Object.entries(masterData.equipmentAliases).filter(([key, name]) => key !== equipmentKey(name));
  const merge = () => {
    const target = mergeTarget.trim() || (mergeSelection[0] ?? '');
    if (!target || !mergeSelection.length) return;
    onMasterDataChange(data => mergeEquipment(data, mergeSelection, target));
    setMergeSelection([]); setMergeTarget('');
  };
  return <>
    <section className={styles.card} aria-labelledby="my-equipment-title">
      <h2 id="my-equipment-title">My equipment</h2>
      <p className={styles.hint}>Tick what you have at home. The library’s “Only my equipment” filter then shows workouts that need nothing more.</p>
      <div className={styles.chipRow}>{equipmentChoices.map(item => <Chip key={item} kind="neutral" pressed={preferences.myEquipment.includes(item)} onClick={() => update({ myEquipment: preferences.myEquipment.includes(item) ? preferences.myEquipment.filter(known => known !== item) : [...preferences.myEquipment, item] })}>{item}</Chip>)}</div>
    </section>
    <section className={styles.card} aria-labelledby="equipment-title">
      <h2 id="equipment-title">Equipment names</h2>
      <p className={styles.hint}>Merge spellings that mean the same thing. Pick the names, type the one to keep, and every card, overview and filter uses it.</p>
      <ul className={styles.usage} aria-label="Equipment in the library">{equipmentUsage.map(item => <li key={item.name}><label><input type="checkbox" checked={mergeSelection.includes(item.name)} onChange={event => setMergeSelection(current => event.target.checked ? [...current, item.name] : current.filter(name => name !== item.name))} /><span>{item.name}</span><small>{item.count} {item.count === 1 ? 'workout' : 'workouts'}</small></label></li>)}</ul>
      <div className={styles.mergeRow}><label className={styles.field}>Keep as<input value={mergeTarget} placeholder={mergeSelection[0] ?? 'Name to keep'} list="equipment-names" onChange={event => setMergeTarget(event.target.value)} /></label><datalist id="equipment-names">{equipmentChoices.map(item => <option key={item} value={item} />)}</datalist><button type="button" className={shared.primaryButton} disabled={mergeSelection.length === 0} onClick={merge}><Icon name="check" />Merge {mergeSelection.length || ''}</button></div>
      {merges.length > 0 && <ul className={styles.merges} aria-label="Merged names">{merges.map(([key, name]) => <li key={key}><span>{key} → <strong>{name}</strong></span><button type="button" className={shared.quietButton} onClick={() => onMasterDataChange(data => unmergeEquipment(data, key))}><Icon name="undo" size={14} />Undo</button></li>)}</ul>}
    </section>
  </>;
}

type MovementForm = { id?: string; name: string; shortName: string; spokenName: string; aliases: string; family: string; category: '' | MovementCategory; equipment: string; loads: MovementLoads; notes: string };
const emptyForm = (): MovementForm => ({ name: '', shortName: '', spokenName: '', aliases: '', family: '', category: '', equipment: '', loads: emptyLoads(), notes: '' });
const toForm = (record: Movement): MovementForm => ({ id: record.id, name: record.name, shortName: record.shortName ?? '', spokenName: record.spokenName ?? '', aliases: (record.aliases ?? []).join(', '), family: record.family ?? '', category: record.category ?? '', equipment: (record.equipment ?? []).join(', '), loads: record.loads ? structuredClone(record.loads) : emptyLoads(), notes: record.notes ?? '' });
const list = (text: string) => text.split(',').map(item => item.trim()).filter(Boolean);

function ExerciseSettings({ masterData, onMasterDataChange, catalogue, entries }: SettingsProps) {
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<string[]>([]);
  const [mergeTarget, setMergeTarget] = useState('');
  const [form, setForm] = useState<MovementForm>();
  const equipmentChoices = useMemo(() => equipmentOptions(entries.map(entry => entry.summary)), [entries]);
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
  const rows = useMemo(() => query.trim() ? rankBySearch(catalogue.records, query, movementSearchFields(catalogue)).map(record => ({ record, variant: Boolean(record.family) })) : catalogue.grouped().flatMap(group => [{ record: group.head, variant: false }, ...group.variants.map(record => ({ record, variant: true }))]), [catalogue, query]);
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
    if (list(form.equipment).length) record.equipment = list(form.equipment);
    if (hasLoads(form.loads)) record.loads = form.loads;
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
  const levelInputs = (sex: Sex) => <div className={styles.levelRow}>{LOAD_LEVELS.map(level => <label key={level} className={styles.levelInput} data-level={level}><span aria-hidden="true">{LEVEL_LETTERS[level]}</span><input type="number" min={0} step="any" aria-label={`${sex === 'men' ? 'Men' : 'Women'} ${level} load`} value={form?.loads[sex][level] || ''} onChange={event => setForm(current => current && ({ ...current, loads: { ...current.loads, [sex]: { ...current.loads[sex], [level]: Number(event.target.value) } } }))} /></label>)}</div>;

  return <>
    {unknown.length > 0 && <section className={styles.card} data-tone="notice" aria-labelledby="unknown-title">
      <h2 id="unknown-title">Not in your exercises yet</h2>
      <p className={styles.hint}>Movements written in library workouts that no record matches. Add them as they are, or rename a record so its name or an alias matches.</p>
      <ul className={styles.unknownList} aria-label="Movements without a record">{unknown.map(([name, count]) => <li key={name}><span>{name}</span><small>{count} {count === 1 ? 'workout' : 'workouts'}</small><button type="button" className={shared.quietButton} onClick={() => addUnknown([name])} aria-label={`Add ${name}`}><Icon name="plus" size={14} />Add</button></li>)}</ul>
      {unknown.length > 1 && <div><button type="button" className={shared.quietButton} onClick={() => addUnknown(unknown.map(([name]) => name))}><Icon name="plus" size={14} />Add all {unknown.length}</button></div>}
    </section>}

    <section className={styles.card} aria-labelledby="exercises-title">
      <div className={styles.cardHeading}><h2 id="exercises-title">Exercises</h2><span className={styles.hint}>{catalogue.records.length} records{customised ? ` · ${customised} ${customised === 1 ? 'change' : 'changes'} of yours` : ''}</span></div>
      <p className={styles.hint}>Variants sit under their family (Hang power cleans under Cleans). Tick two or more to merge them; every merged name keeps resolving to the one you keep.</p>
      <div className={styles.exerciseTop}>
        <label className={`${styles.field} ${styles.search}`}>Find<input type="search" value={query} placeholder="thruster, clean, kettlebell…" aria-label="Find exercises" onChange={event => setQuery(event.target.value)} /></label>
        <button type="button" className={shared.primaryButton} onClick={() => setForm(emptyForm())}><Icon name="plus" size={16} />New exercise</button>
      </div>
      {selection.length >= 2 && <div className={styles.mergeBar} role="group" aria-label="Merge selected exercises">
        <span>{selection.length} selected</span>
        <label className={styles.field}>Keep<select value={mergeTarget || selection[0]} aria-label="Keep as" onChange={event => setMergeTarget(event.target.value)}>{selectedRecords.map(record => <option key={record.id} value={record.id}>{record.name}</option>)}</select></label>
        <button type="button" className={shared.primaryButton} onClick={merge}><Icon name="check" />Merge {selection.length}</button>
        <button type="button" className={shared.quietButton} onClick={() => setSelection([])}>Clear</button>
      </div>}
      <ul className={styles.exerciseList} aria-label="Exercises">
        {rows.map(({ record, variant }) => {
          const count = usage.get(record.id) ?? 0;
          const head = variant && record.family ? catalogue.get(record.family) : undefined;
          return <li key={record.id} data-variant={variant || undefined} data-custom={!seedIds.has(record.id) || undefined}>
            <label className={styles.select}><input type="checkbox" checked={selection.includes(record.id)} aria-label={`Select ${record.name}`} onChange={event => setSelection(current => event.target.checked ? [...current, record.id] : current.filter(id => id !== record.id))} /></label>
            <div className={styles.exerciseName}>
              <strong>{record.name}</strong>
              <small>{[query && head ? `${head.name} variant` : '', record.shortName ? `short: ${record.shortName}` : '', record.aliases?.length ? `also ${record.aliases.join(', ')}` : '', record.category ? CATEGORY_LABELS[record.category] : ''].filter(Boolean).join(' · ')}</small>
            </div>
            <div className={styles.exerciseFacts}>
              <span className={styles.chipRow}>{(record.equipment ?? []).map(item => <Chip key={item} kind="neutral">{item}</Chip>)}{!record.equipment?.length && <Chip kind="neutral">Bodyweight</Chip>}</span>
              {record.loads && hasLoads(record.loads) && <small title="Men L / M / H · Women L / M / H">{loadsText(record.loads)}</small>}
              <small>{count ? `${count} ${count === 1 ? 'workout' : 'workouts'}` : 'unused'}</small>
            </div>
            <div className={styles.rowActions}>
              <button type="button" className={shared.quietButton} onClick={() => setForm(toForm(record))} aria-label={`Edit ${record.name}`}>Edit</button>
              <button type="button" className={shared.quietButton} onClick={() => onMasterDataChange(data => removeMovement(data, record.id))} aria-label={`Remove ${record.name}`}><Icon name="trash" size={14} /></button>
            </div>
          </li>;
        })}
        {rows.length === 0 && <li className={styles.emptyRow}>Nothing matches “{query}”.</li>}
      </ul>
      {Object.keys(masterData.movementAliases).length > 0 && <ul className={styles.merges} aria-label="Merged movement names">{Object.entries(masterData.movementAliases).map(([spelling, id]) => <li key={spelling}><span>{spelling} → <strong>{catalogue.get(id)?.name ?? id}</strong></span><button type="button" className={shared.quietButton} onClick={() => onMasterDataChange(data => removeMovementAlias(data, spelling))}><Icon name="undo" size={14} />Undo</button></li>)}</ul>}
      {customised > 0 && <div><button type="button" className={shared.quietButton} onClick={() => onMasterDataChange(data => ({ ...data, movements: data.movements.filter(record => !seedIds.has(record.id)), hiddenMovements: [], movementAliases: {} }))}>Restore the bundled exercises</button></div>}
    </section>

    {form && <section className={styles.card} aria-labelledby="exercise-form-title">
      <h2 id="exercise-form-title">{form.id ? `Edit ${catalogue.get(form.id)?.name ?? 'exercise'}` : 'New exercise'}</h2>
      <div className={styles.formGrid}>
        <label className={styles.field}>Name<input value={form.name} maxLength={160} placeholder="Hang power cleans" onChange={event => setForm({ ...form, name: event.target.value })} /></label>
        <label className={styles.field}>Family<select value={form.family} onChange={event => setForm({ ...form, family: event.target.value })}><option value="">None (stands alone)</option>{heads.filter(head => head.id !== form.id).map(head => <option key={head.id} value={head.id}>{head.name}</option>)}</select></label>
        <label className={styles.field}>Short name<input value={form.shortName} maxLength={60} placeholder="HPC" onChange={event => setForm({ ...form, shortName: event.target.value })} /></label>
        <label className={styles.field}>Spoken name<input value={form.spokenName} maxLength={160} placeholder="hang power cleans" onChange={event => setForm({ ...form, spokenName: event.target.value })} /></label>
        <label className={styles.field}>Also known as<input value={form.aliases} maxLength={500} placeholder="HPC, hang power clean" onChange={event => setForm({ ...form, aliases: event.target.value })} /></label>
        <label className={styles.field}>Category<select value={form.category} onChange={event => setForm({ ...form, category: event.target.value as MovementForm['category'] })}><option value="">Unset</option>{MOVEMENT_CATEGORIES.map(category => <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>)}</select></label>
        <label className={styles.field}>Equipment<input value={form.equipment} maxLength={300} list="equipment-names" placeholder="Barbell" onChange={event => setForm({ ...form, equipment: event.target.value })} /><datalist id="equipment-names">{equipmentChoices.map(item => <option key={item} value={item} />)}</datalist></label>
        <label className={styles.field}>Load unit<select value={form.loads.unit} onChange={event => setForm({ ...form, loads: { ...form.loads, unit: event.target.value as MovementLoads['unit'] } })}><option value="kg">kg</option><option value="lb">lb</option></select></label>
        <div className={styles.field}><span>Men · light, medium, heavy</span>{levelInputs('men')}</div>
        <div className={styles.field}><span>Women · light, medium, heavy</span>{levelInputs('women')}</div>
        <label className={`${styles.field} ${styles.wide}`}>Notes<input value={form.notes} maxLength={500} placeholder="Standards, scaling, cues" onChange={event => setForm({ ...form, notes: event.target.value })} /></label>
      </div>
      <div className={styles.rowActions}><button type="button" className={shared.primaryButton} disabled={!form.name.trim()} onClick={save}><Icon name="check" />{form.id ? 'Save exercise' : 'Add exercise'}</button><button type="button" className={shared.quietButton} onClick={() => setForm(undefined)}>Cancel</button></div>
    </section>}
  </>;
}

function CollectionSettings({ masterData, onMasterDataChange, entries }: SettingsProps) {
  const [collectionTitle, setCollectionTitle] = useState('');
  const [collectionIds, setCollectionIds] = useState<string[]>([]);
  const [editingCollection, setEditingCollection] = useState<string>();
  const [collectionSearch, setCollectionSearch] = useState('');
  const collections = allCollections(masterData);
  const saveCollection = () => {
    const title = collectionTitle.trim();
    if (!title) return;
    const id = editingCollection ?? (() => { const base = slug(title); let candidate = base; for (let n = 2; collections.some(item => item.id === candidate); n++) candidate = `${base}-${n}`; return candidate; })();
    onMasterDataChange(data => upsertCollection(data, { id, title, workoutIds: collectionIds }));
    setCollectionTitle(''); setCollectionIds([]); setEditingCollection(undefined);
  };
  const editCollection = (collection: Collection) => { setEditingCollection(collection.id); setCollectionTitle(collection.title); setCollectionIds([...collection.workoutIds]); };
  const visibleWorkouts = entries.filter(entry => !collectionSearch.trim() || entry.summary.title.toLowerCase().includes(collectionSearch.toLowerCase()));
  return <section className={styles.card} aria-labelledby="collections-title">
    <h2 id="collections-title">Collections</h2>
    <p className={styles.hint}>Named lists of workouts, shown as chips on cards and as a filter. Bundled collections are read-only; make your own beside them.</p>
    <ul className={styles.collectionList} aria-label="Collections">{collections.map(collection => <li key={collection.id}><div><strong>{collection.title}</strong><small>{collection.workoutIds.length} {collection.workoutIds.length === 1 ? 'workout' : 'workouts'}{collection.builtIn ? ' · bundled' : ''}{collection.description ? ` · ${collection.description}` : ''}</small></div>{!collection.builtIn && <div className={styles.rowActions}><button type="button" className={shared.quietButton} onClick={() => editCollection(collection)}>Edit</button><button type="button" className={shared.quietButton} aria-label={`Remove collection ${collection.title}`} onClick={() => onMasterDataChange(data => removeCollection(data, collection.id))}><Icon name="trash" size={14} />Remove</button></div>}</li>)}</ul>
    <div className={styles.collectionForm}>
      <label className={styles.field}>{editingCollection ? 'Collection title' : 'New collection'}<input value={collectionTitle} maxLength={120} placeholder="Tuesday favourites" onChange={event => setCollectionTitle(event.target.value)} /></label>
      <label className={styles.field}>Find workouts<input type="search" value={collectionSearch} placeholder="Filter by title" onChange={event => setCollectionSearch(event.target.value)} /></label>
      <div className={styles.chipRow} role="group" aria-label="Workouts in this collection">{visibleWorkouts.map(entry => <Chip key={entry.workout.id} kind="neutral" pressed={collectionIds.includes(entry.workout.id)} onClick={() => setCollectionIds(current => current.includes(entry.workout.id) ? current.filter(id => id !== entry.workout.id) : [...current, entry.workout.id])}>{entry.summary.title}</Chip>)}</div>
      <div className={styles.rowActions}><button type="button" className={shared.primaryButton} disabled={!collectionTitle.trim()} onClick={saveCollection}><Icon name="check" />{editingCollection ? 'Save collection' : 'Create collection'}</button>{editingCollection && <button type="button" className={shared.quietButton} onClick={() => { setEditingCollection(undefined); setCollectionTitle(''); setCollectionIds([]); }}>Cancel</button>}<span className={styles.hint}>{collectionIds.length} selected</span></div>
    </div>
  </section>;
}
