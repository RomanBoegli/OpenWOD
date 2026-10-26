import { useMemo, useState } from 'react';
import { equipmentKey, equipmentOptions } from '../../../../packages/domain/src/library';
import { commitMerge, mergeEquipment, unmergeEquipment } from '../master-data';
import { MasterList } from './MasterList';
import { FormDialog } from './FormDialog';
import type { Preferences } from '../preferences';
import { Icon } from '../Icon';
import styles from '../Settings.module.css';
import shared from '../App.module.css';
import { type SettingsProps } from './shared';

export function EquipmentSettings({ preferences, onPreferencesChange, masterData, onMasterDataChange, entries }: SettingsProps) {
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
