import { useState } from 'react';
import { allCollections, removeCollection, upsertCollection, type Collection } from '../master-data';
import { bundledWorkouts } from '../../../../packages/domain/src/bundled';
import { MasterList } from './MasterList';
import { FormDialog } from './FormDialog';
import { ConfirmDialog } from '../ConfirmDialog';
import { Chip } from '../Chip';
import { Icon } from '../Icon';
import styles from '../Settings.module.css';
import shared from '../App.module.css';
import { type SettingsProps, plural, slug } from './shared';

type CollectionForm = { id?: string; title: string; description: string; workoutIds: string[] };

export function CollectionSettings({ masterData, onMasterDataChange, entries, household }: SettingsProps) {
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
  const hidden = masterData.hiddenWorkouts.map(id => bundledWorkouts.find(workout => workout.id === id)).filter(workout => workout !== undefined);
  const restore = (id: string) => onMasterDataChange(data => ({ ...data, hiddenWorkouts: data.hiddenWorkouts.filter(item => item !== id) }));
  const visibleWorkouts = entries.filter(entry => !search.trim() || entry.summary.title.toLowerCase().includes(search.toLowerCase()));
  return <>
    <section className={styles.card} aria-labelledby="collections-title">
      <div className={styles.cardHeading}><h2 id="collections-title">Collections</h2><span className={styles.hint}>{collections.length} collections</span></div>
      <p className={styles.hint}>Named lists of workouts, shown in the corner of each card and as a filter. A workout belongs to one collection at a time; adding it to another moves it. The collections that come with the app can be edited but not removed; make your own beside them.</p>
      <div className={styles.listTop}><span /><button type="button" className={shared.primaryButton} onClick={() => open()}><Icon name="plus" size={16} />New collection</button></div>
      <MasterList label="Collections" actionsWidth="172px" empty="No collections yet."
        columns={[{ key: 'title', caption: 'Collection' }, { key: 'count', caption: 'Workouts', width: '90px', align: 'end' }]}
        rows={collections.map(collection => ({
          id: collection.id,
          cells: { title: <><strong>{collection.title}</strong>{collection.description && <small>{collection.description}</small>}</>, count: collection.workoutIds.length },
          actions: <>
            <button type="button" className={shared.quietButton} aria-label={`Edit collection ${collection.title}`} onClick={() => open(collection)}><Icon name="edit" size={14} />Edit</button>
            <button type="button" className={shared.quietButton} aria-label={`Export collection ${collection.title}`} title="Every workout of the collection as one .wods.yaml pack" disabled={!collection.workoutIds.length} onClick={() => household.exportPack(collection.title, collection.workoutIds)}><Icon name="download" size={14} /></button>
            {!collection.builtIn && <button type="button" className={shared.quietButton} aria-label={`Remove collection ${collection.title}`} onClick={() => setRemoving(collection)}><Icon name="trash" size={14} /></button>}
          </>,
        }))} />
    </section>
    {hidden.length > 0 && <section className={styles.card} aria-labelledby="removed-title">
      <div className={styles.cardHeading}><h2 id="removed-title">Removed workouts</h2><span className={styles.hint}>{plural(hidden.length, 'workout')}</span></div>
      <p className={styles.hint}>Workouts that come with the app are hidden when you remove them, never deleted. Restore one to bring it back to the library, with any edits you made to it.</p>
      <MasterList label="Removed workouts" actionsWidth="120px" empty="Nothing removed."
        columns={[{ key: 'title', caption: 'Workout' }]}
        rows={hidden.map(workout => ({
          id: workout.id,
          cells: { title: <strong>{workout.title}</strong> },
          actions: <button type="button" className={shared.quietButton} aria-label={`Restore ${workout.title}`} onClick={() => restore(workout.id)}><Icon name="back" size={14} />Restore</button>,
        }))} />
    </section>}
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
