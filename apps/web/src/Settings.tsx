import { useMemo, useState } from 'react';
import { equipmentKey, equipmentOptions } from '../../../packages/domain/src/library';
import { LOAD_LEVELS } from '../../../packages/domain/src/schema';
import type { WorkoutAudio } from './audio';
import { pickDefaultVoice } from './audio';
import type { LibraryEntry } from './Library';
import { allCollections, mergeEquipment, removeCollection, removeMovementLoads, unmergeEquipment, upsertCollection, upsertMovementLoads, type Collection, type MasterData, type MovementLoads, type Sex } from './master-data';
import type { Preferences } from './preferences';
import { LEVEL_LETTERS } from './LevelChip';
import { Chip } from './Chip';
import { Icon } from './Icon';
import styles from './Settings.module.css';
import shared from './App.module.css';

interface SettingsProps {
  preferences: Preferences;
  onPreferencesChange: (update: (value: Preferences) => Preferences) => void;
  masterData: MasterData;
  onMasterDataChange: (update: (value: MasterData) => MasterData) => void;
  entries: LibraryEntry[];
  voices: SpeechSynthesisVoice[];
  clipsReady?: boolean;
  packs: { id: string; label: string }[];
  audio: WorkoutAudio;
}

const slug = (title: string) => title.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'collection';
const emptyLoads = (): MovementLoads => ({ name: '', unit: 'kg', men: { light: 0, medium: 0, heavy: 0 }, women: { light: 0, medium: 0, heavy: 0 } });

/** Everything about this device and its master data, on one page: appearance, athletes, sound, equipment, movements, collections. */
export function Settings({ preferences, onPreferencesChange, masterData, onMasterDataChange, entries, voices, clipsReady, packs, audio }: SettingsProps) {
  const update = (patch: Partial<Preferences>) => onPreferencesChange(value => ({ ...value, ...patch }));
  const [mergeSelection, setMergeSelection] = useState<string[]>([]);
  const [mergeTarget, setMergeTarget] = useState('');
  const [loads, setLoads] = useState<MovementLoads>(emptyLoads);
  const [collectionTitle, setCollectionTitle] = useState('');
  const [collectionIds, setCollectionIds] = useState<string[]>([]);
  const [editingCollection, setEditingCollection] = useState<string>();
  const [collectionSearch, setCollectionSearch] = useState('');

  // Equipment as the library sees it after merges, with how many workouts need each item.
  const equipmentUsage = useMemo(() => {
    const counts = new Map<string, { name: string; count: number }>();
    for (const entry of entries) for (const item of entry.summary.equipmentNeeded) { const key = equipmentKey(item); counts.set(key, { name: item, count: (counts.get(key)?.count ?? 0) + 1 }); }
    return [...counts.values()].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  }, [entries]);
  const equipmentChoices = useMemo(() => equipmentOptions(entries.map(entry => entry.summary)), [entries]);
  const movementNames = useMemo(() => [...new Set(entries.flatMap(entry => entry.summary.movements))].sort((a, b) => a.localeCompare(b, 'en')), [entries]);
  const merges = Object.entries(masterData.equipmentAliases).filter(([key, name]) => key !== equipmentKey(name));
  const collections = allCollections(masterData);

  const merge = () => {
    const target = mergeTarget.trim() || (mergeSelection[0] ?? '');
    if (!target || !mergeSelection.length) return;
    onMasterDataChange(data => mergeEquipment(data, mergeSelection, target));
    setMergeSelection([]); setMergeTarget('');
  };
  const saveLoads = () => {
    if (!loads.name.trim()) return;
    onMasterDataChange(data => upsertMovementLoads(data, { ...loads, name: loads.name.trim() }));
    setLoads(emptyLoads());
  };
  const saveCollection = () => {
    const title = collectionTitle.trim();
    if (!title) return;
    const id = editingCollection ?? (() => { const base = slug(title); let candidate = base; for (let n = 2; collections.some(item => item.id === candidate); n++) candidate = `${base}-${n}`; return candidate; })();
    onMasterDataChange(data => upsertCollection(data, { id, title, workoutIds: collectionIds }));
    setCollectionTitle(''); setCollectionIds([]); setEditingCollection(undefined);
  };
  const editCollection = (collection: Collection) => { setEditingCollection(collection.id); setCollectionTitle(collection.title); setCollectionIds([...collection.workoutIds]); };
  const levelInputs = (sex: Sex) => <div className={styles.levelRow}>{LOAD_LEVELS.map(level => <label key={level} className={styles.levelInput} data-level={level}><span aria-hidden="true">{LEVEL_LETTERS[level]}</span><input type="number" min={0} step="any" aria-label={`${sex === 'men' ? 'Men' : 'Women'} ${level} load`} value={loads[sex][level] || ''} onChange={event => setLoads(current => ({ ...current, [sex]: { ...current[sex], [level]: Number(event.target.value) } }))} /></label>)}</div>;
  const visibleWorkouts = entries.filter(entry => !collectionSearch.trim() || entry.summary.title.toLowerCase().includes(collectionSearch.toLowerCase()));

  return <div className={styles.settings}>
    <div className={shared.workoutHeading}><div><div className={shared.eyebrow}><a href="#/">YOUR LIBRARY</a> <span>/</span> SETTINGS</div><h1>Make it yours</h1><p className={shared.description}>Saved on this device. Appearance, athletes, sound, your equipment, and the master data behind the library.</p></div></div>

    <div className={styles.grid}>
      <section className={styles.card} aria-labelledby="appearance-title">
        <h2 id="appearance-title">Appearance</h2>
        <fieldset className={shared.segmented}><legend>Theme</legend>{([['auto', 'Auto', 'auto'], ['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']] as const).map(([value, label, icon]) => <label key={value} data-checked={preferences.theme === value}><input type="radio" name="theme" value={value} checked={preferences.theme === value} onChange={() => update({ theme: value })} /><Icon name={icon} size={16} />{label}</label>)}</fieldset>
        <label className={shared.chipToggle} data-checked={preferences.wash}><input type="checkbox" checked={preferences.wash} onChange={event => update({ wash: event.target.checked })} />Background pulse: the phase colour tints the player and deepens as the clock drains</label>
        <label className={styles.field}>Default player view<select value={preferences.view} onChange={event => update({ view: event.target.value as Preferences['view'] })}><option value="focus">Focus</option><option value="context">Context</option></select></label>
      </section>

      <section className={styles.card} aria-labelledby="athletes-title">
        <h2 id="athletes-title">Athletes</h2>
        <p className={styles.hint}>A stays on the left, B on the right. Loads from the movement table below follow each athlete’s choice; a workout’s own levels are always shown as written.</p>
        {(['A', 'B'] as const).map(role => <div key={role} className={styles.athleteRow}>
          <label className={styles.field}>Athlete {role}<input maxLength={30} value={preferences.names[role]} onChange={event => update({ names: { ...preferences.names, [role]: event.target.value } })} /></label>
          <fieldset className={shared.segmented} data-two><legend>Shows loads for</legend>{(['men', 'women'] as const).map(sex => <label key={sex} data-checked={preferences.loadsFor[role] === sex}><input type="radio" name={`loads-${role}`} value={sex} checked={preferences.loadsFor[role] === sex} onChange={() => update({ loadsFor: { ...preferences.loadsFor, [role]: sex } })} />{sex === 'men' ? 'Men' : 'Women'}</label>)}</fieldset>
        </div>)}
      </section>

      <section className={styles.card} aria-labelledby="sound-title">
        <h2 id="sound-title">Sound and voice</h2>
        <label className={styles.field}>Sound<select value={preferences.soundMode} onChange={event => update({ soundMode: event.target.value as Preferences['soundMode'] })}><option value="voice">Voice + beeps</option><option value="beeps">Beeps only</option><option value="silent">Silent</option></select></label>
        <label className={styles.field}>Fixed cues (Go, Rest, countdown)<select value={preferences.cueSource === 'device' ? 'device' : preferences.cuePack || (packs[0]?.id ?? '')} onChange={event => update(event.target.value === 'device' ? { cueSource: 'device' } : { cueSource: 'clips', cuePack: event.target.value })}>{packs.map(pack => <option key={pack.id} value={pack.id}>Recorded · {pack.label}</option>)}{packs.length === 0 && <option value="">Recorded voice (not installed in this build)</option>}<option value="device">Device voice</option></select>{preferences.cueSource === 'clips' && clipsReady === false && <small className={shared.fieldNote}>Recorded cues are not installed in this build, so the device voice is used. The Docker image renders them; locally run `npm run cues:generate`.</small>}<small className={shared.fieldNote}>Recorded voices are English only, rendered with the open Piper voices: British, American and Scottish. No other accents exist in that set.</small></label>
        <label className={styles.field}>Device voice for movement names<select value={preferences.voiceURI} onChange={event => update({ voiceURI: event.target.value })}><option value="">{pickDefaultVoice(voices) ? `Best available (${pickDefaultVoice(voices)!.name})` : 'Device default'}</option>{voices.map(voice => <option value={voice.voiceURI} key={voice.voiceURI}>{voice.name} · {voice.lang}</option>)}</select></label>
        <div className={styles.twoUp}>
          <label className={styles.field}>Speech speed<input type="range" min="0.7" max="1.3" step="0.1" value={preferences.rate} onChange={event => update({ rate: Number(event.target.value) })} /></label>
          <label className={styles.field}>Volume<input type="range" min="0" max="1" step="0.1" value={preferences.volume} onChange={event => update({ volume: Number(event.target.value) })} /></label>
        </div>
        <button type="button" className={shared.quietButton} onClick={() => void audio.test()} disabled={preferences.soundMode === 'silent'}><Icon name="sound" />Test sound</button>
        <p className={styles.hint}>Switching tabs pauses a running workout. Keep the window visible while training.</p>
      </section>

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

      <section className={styles.card} aria-labelledby="movements-title">
        <h2 id="movements-title">Movement loads</h2>
        <p className={styles.hint}>Default light, medium and heavy loads per movement for men and women. Shown wherever a workout names the movement without its own levels.</p>
        {masterData.movementLoads.length > 0 && <table className={styles.table}><thead><tr><th scope="col">Movement</th><th scope="col">Men L / M / H</th><th scope="col">Women L / M / H</th><th scope="col"><span className={styles.srOnly}>Actions</span></th></tr></thead><tbody>{masterData.movementLoads.map(item => <tr key={item.name}><td>{item.name}</td><td>{item.men.light} / {item.men.medium} / {item.men.heavy} {item.unit}</td><td>{item.women.light} / {item.women.medium} / {item.women.heavy} {item.unit}</td><td><button type="button" className={shared.quietButton} onClick={() => setLoads(item)}>Edit</button><button type="button" className={shared.quietButton} aria-label={`Remove loads for ${item.name}`} onClick={() => onMasterDataChange(data => removeMovementLoads(data, item.name))}><Icon name="trash" size={14} /></button></td></tr>)}</tbody></table>}
        <div className={styles.loadsForm}>
          <label className={styles.field}>Movement<input value={loads.name} list="movement-names" placeholder="Thrusters" onChange={event => setLoads(current => ({ ...current, name: event.target.value }))} /></label>
          <datalist id="movement-names">{movementNames.map(name => <option key={name} value={name} />)}</datalist>
          <label className={styles.field}>Unit<select value={loads.unit} onChange={event => setLoads(current => ({ ...current, unit: event.target.value as MovementLoads['unit'] }))}><option value="kg">kg</option><option value="lb">lb</option></select></label>
          <div className={styles.field}><span>Men</span>{levelInputs('men')}</div>
          <div className={styles.field}><span>Women</span>{levelInputs('women')}</div>
          <button type="button" className={shared.primaryButton} disabled={!loads.name.trim()} onClick={saveLoads}><Icon name="check" />Save movement</button>
        </div>
      </section>

      <section className={styles.card} aria-labelledby="collections-title">
        <h2 id="collections-title">Collections</h2>
        <p className={styles.hint}>Named lists of workouts, shown as chips on cards and as a filter. Bundled collections are read-only; make your own beside them.</p>
        <ul className={styles.collectionList} aria-label="Collections">{collections.map(collection => <li key={collection.id}><div><strong>{collection.title}</strong><small>{collection.workoutIds.length} {collection.workoutIds.length === 1 ? 'workout' : 'workouts'}{collection.builtIn ? ' · bundled' : ''}{collection.description ? ` · ${collection.description}` : ''}</small></div>{!collection.builtIn && <div className={styles.rowActions}><button type="button" className={shared.quietButton} onClick={() => editCollection(collection)}>Edit</button><button type="button" className={shared.quietButton} aria-label={`Remove collection ${collection.title}`} onClick={() => onMasterDataChange(data => removeCollection(data, collection.id))}><Icon name="trash" size={14} />Remove</button></div>}</li>)}</ul>
        <div className={styles.collectionForm}>
          <label className={styles.field}>{editingCollection ? 'Collection title' : 'New collection'}<input value={collectionTitle} maxLength={120} placeholder="Tuesday favourites" onChange={event => setCollectionTitle(event.target.value)} /></label>
          <label className={styles.field}>Find workouts<input type="search" value={collectionSearch} placeholder="Filter by title" onChange={event => setCollectionSearch(event.target.value)} /></label>
          <div className={styles.chipRow} role="group" aria-label="Workouts in this collection">{visibleWorkouts.map(entry => <Chip key={entry.workout.id} kind="neutral" pressed={collectionIds.includes(entry.workout.id)} onClick={() => setCollectionIds(current => current.includes(entry.workout.id) ? current.filter(id => id !== entry.workout.id) : [...current, entry.workout.id])}>{entry.summary.title}</Chip>)}</div>
          <div className={styles.rowActions}><button type="button" className={shared.primaryButton} disabled={!collectionTitle.trim()} onClick={saveCollection}><Icon name="check" />{editingCollection ? 'Save collection' : 'Create collection'}</button>{editingCollection && <button type="button" className={shared.quietButton} onClick={() => { setEditingCollection(undefined); setCollectionTitle(''); setCollectionIds([]); }}>Cancel</button>}<span className={styles.hint}>{collectionIds.length} selected</span></div>
        </div>
      </section>
    </div>
  </div>;
}
