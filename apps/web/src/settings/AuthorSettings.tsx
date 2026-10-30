import { useMemo, useState } from 'react';
import { authorKey } from '../../../../packages/domain/src/library';
import { addAuthor, authorRepertoire, authorSpelling, commitMerge, mergeAuthors, removeAuthor, restoreAuthor, unmergeAuthor } from '../master-data';
import { MasterList } from './MasterList';
import { FormDialog } from './FormDialog';
import { ConfirmDialog } from '../ConfirmDialog';
import { Icon } from '../Icon';
import styles from '../Settings.module.css';
import shared from '../App.module.css';
import { type SettingsProps, plural } from './shared';

/**
 * Authors as master data (LIB-06): the names library workouts carry, after merges, plus those added by hand. Renames,
 * merges and deletions change what the library shows, searches and suggests; workout files keep their own text.
 */
export function AuthorSettings({ masterData, onMasterDataChange, entries }: SettingsProps) {
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<string[]>([]);
  const [mergeTarget, setMergeTarget] = useState('');
  const [renaming, setRenaming] = useState<{ from: string; to: string }>();
  const [adding, setAdding] = useState<string>();
  const [removing, setRemoving] = useState<string>();
  // Summaries already carry each author in its kept spelling, without deleted ones.
  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries) if (entry.summary.author) counts.set(authorKey(entry.summary.author), (counts.get(authorKey(entry.summary.author)) ?? 0) + 1);
    return counts;
  }, [entries]);
  const names = useMemo(() => authorRepertoire(masterData, entries.flatMap(entry => entry.summary.author ? [entry.summary.author] : [])), [masterData, entries]);
  // Deleted authors by the spelling the library would show, with how many workouts still name them.
  const deleted = useMemo(() => masterData.hiddenAuthors.map(key => {
    const spellings = entries.flatMap(entry => entry.workout.attribution?.author ? [authorSpelling(masterData)(entry.workout.attribution.author)] : []).filter(name => authorKey(name) === key);
    return { key, name: spellings[0] ?? key, count: spellings.length };
  }), [masterData, entries]);
  const visible = names.filter(name => !query.trim() || name.toLowerCase().includes(query.trim().toLowerCase()));
  const merges = Object.entries(masterData.authorAliases).filter(([key, name]) => key !== authorKey(name) && !masterData.committed.includes(`author:${key}`));
  const used = (name: string) => usage.get(authorKey(name)) ?? 0;

  const merge = () => {
    const target = mergeTarget.trim() || selection[0];
    if (!target || selection.length < 2) return;
    onMasterDataChange(data => mergeAuthors(data, selection, target));
    setSelection([]); setMergeTarget('');
  };
  const rename = () => {
    const to = renaming?.to.trim();
    if (renaming && to && to !== renaming.from) onMasterDataChange(data => mergeAuthors(data, [renaming.from], to));
    setRenaming(undefined);
  };
  const add = () => {
    if (adding?.trim()) onMasterDataChange(data => addAuthor(data, adding));
    setAdding(undefined);
  };

  return <>
    <section className={styles.card} aria-labelledby="authors-title">
      <div className={styles.cardHeading}><h2 id="authors-title">Authors</h2><span className={styles.hint}>{plural(names.length, 'author')}</span></div>
      <p className={styles.hint}>Who wrote or published your workouts. Rename an author, or tick two or more and merge them into one spelling used on every page, in search, in the filters and in the editor’s suggestions. Workout files keep their own text.</p>
      <div className={styles.listTop}>
        <label className={`${styles.field} ${styles.search}`}>Find<input type="search" value={query} placeholder="CrossFit, coach…" aria-label="Find authors" onChange={event => setQuery(event.target.value)} /></label>
        <button type="button" className={shared.primaryButton} onClick={() => setAdding('')}><Icon name="plus" size={16} />New author</button>
      </div>
      {selection.length >= 2 && <div className={styles.mergeBar} role="group" aria-label="Merge selected authors">
        <span>{selection.length} selected</span>
        <label className={styles.field}>Keep as<input value={mergeTarget} placeholder={selection[0]} list="author-names" aria-label="Keep as" maxLength={160} onChange={event => setMergeTarget(event.target.value)} /></label>
        <datalist id="author-names">{names.map(item => <option key={item} value={item} />)}</datalist>
        <button type="button" className={shared.primaryButton} onClick={merge}><Icon name="check" />Merge {selection.length}</button>
        <button type="button" className={shared.quietButton} onClick={() => setSelection([])}>Clear</button>
      </div>}
      <MasterList label="Authors in the library" selectable actionsWidth="220px" empty={query.trim() ? `Nothing matches “${query}”.` : 'No workout names an author yet.'}
        columns={[{ key: 'name', caption: 'Name' }, { key: 'usage', caption: 'Workouts', width: '90px', align: 'end' }]}
        rows={visible.map(name => ({
          id: name,
          cells: { name: <strong>{name}</strong>, usage: used(name) },
          select: { checked: selection.includes(name), label: `Select ${name}`, onChange: checked => setSelection(current => checked ? [...current, name] : current.filter(item => item !== name)) },
          actions: <span className={styles.rowActions}>
            <button type="button" className={shared.quietButton} aria-label={`Rename ${name}`} onClick={() => setRenaming({ from: name, to: name })}><Icon name="edit" size={14} />Rename</button>
            <button type="button" className={shared.quietButton} aria-label={`Delete ${name}`} onClick={() => setRemoving(name)}><Icon name="trash" size={14} />Delete</button>
          </span>,
        }))} />
      {merges.length > 0 && <ul className={styles.merges} aria-label="Merged author names">{merges.map(([key, name]) => <li key={key}><span>{key} → <strong>{name}</strong></span><span className={styles.rowActions}><button type="button" className={shared.quietButton} onClick={() => onMasterDataChange(data => unmergeAuthor(data, key))}><Icon name="undo" size={14} />Undo</button><button type="button" className={shared.quietButton} title="Keep this for good and drop it from the list" aria-label={`Commit ${key}`} onClick={() => onMasterDataChange(data => commitMerge(data, `author:${key}`))}><Icon name="check" size={14} />Commit</button></span></li>)}</ul>}
      {deleted.length > 0 && <ul className={styles.merges} aria-label="Deleted authors">{deleted.map(item => <li key={item.key}><span><strong>{item.name}</strong> · {plural(item.count, 'workout')} without an author</span><span className={styles.rowActions}><button type="button" className={shared.quietButton} aria-label={`Restore ${item.name}`} onClick={() => onMasterDataChange(data => restoreAuthor(data, item.key))}><Icon name="undo" size={14} />Restore</button></span></li>)}</ul>}
    </section>
    <FormDialog open={Boolean(renaming)} title={`Rename ${renaming?.from ?? ''}`} submitLabel="Rename" disabled={!renaming?.to.trim()} onSubmit={rename} onClose={() => setRenaming(undefined)}>
      <label>Name<input value={renaming?.to ?? ''} maxLength={160} onChange={event => setRenaming(current => current && { ...current, to: event.target.value })} /></label>
      <p className={shared.fieldNote}>Every workout by “{renaming?.from}” shows the new spelling; the file text is not changed.</p>
    </FormDialog>
    <FormDialog open={adding !== undefined} title="New author" submitLabel="Add author" disabled={!adding?.trim()} onSubmit={add} onClose={() => setAdding(undefined)}>
      <label>Name<input value={adding ?? ''} maxLength={160} onChange={event => setAdding(event.target.value)} /></label>
      <p className={shared.fieldNote}>The editor suggests it as soon as you start typing an author.</p>
    </FormDialog>
    <ConfirmDialog open={Boolean(removing)} title={`Delete ${removing ?? ''}?`} confirmLabel="Delete" cancelLabel="Keep it" onConfirm={() => { if (removing) onMasterDataChange(data => removeAuthor(data, removing, used(removing) > 0)); setSelection(current => current.filter(item => item !== removing)); setRemoving(undefined); }} onClose={() => setRemoving(undefined)}>
      <p>{removing && (used(removing) ? `${plural(used(removing), 'workout')} name it and then show no author in this library. Their files keep it, and Restore brings it back.` : 'No workout in your library names it.')}</p>
    </ConfirmDialog>
  </>;
}
