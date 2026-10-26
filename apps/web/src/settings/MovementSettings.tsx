import { useMemo, useState } from 'react';
import { CATEGORY_LABELS, MOVEMENT_CATEGORIES, movementSlug, type Movement, type MovementCategory } from '../../../../packages/domain/src/catalogue';
import { collectPrescriptions } from '../../../../packages/domain/src/library';
import { commitMerge, freeMovementId, mergeMovements, removeMovement, removeMovementAlias, restoreBundledMovements, seedIds, upsertMovement } from '../master-data';
import { recordForName } from '../catalogue-link';
import { movementRows } from './movement-rows';
import { Badge, MasterList } from './MasterList';
import { FormDialog } from './FormDialog';
import { TagPicker } from '../TagPicker';
import { equipmentRepertoire } from '../equipment';
import { ConfirmDialog } from '../ConfirmDialog';
import { Chip } from '../Chip';
import { Icon } from '../Icon';
import styles from '../Settings.module.css';
import shared from '../App.module.css';
import { type SettingsProps, plural } from './shared';

type MovementForm = { id?: string; name: string; shortName: string; spokenName: string; aliases: string; family: string; category: '' | MovementCategory; equipment: string[]; notes: string };
const emptyForm = (): MovementForm => ({ name: '', shortName: '', spokenName: '', aliases: '', family: '', category: '', equipment: [], notes: '' });
const toForm = (record: Movement): MovementForm => ({ id: record.id, name: record.name, shortName: record.shortName ?? '', spokenName: record.spokenName ?? '', aliases: (record.aliases ?? []).join(', '), family: record.family ?? '', category: record.category ?? '', equipment: [...(record.equipment ?? [])], notes: record.notes ?? '' });
const list = (text: string) => text.split(',').map(item => item.trim()).filter(Boolean);

export function MovementSettings({ masterData, onMasterDataChange, catalogue, entries }: SettingsProps) {
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
