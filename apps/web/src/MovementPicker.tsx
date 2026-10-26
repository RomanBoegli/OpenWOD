import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Catalogue, Movement } from '../../../packages/domain/src/catalogue';
import { rankBySearch } from '../../../packages/domain/src/search';
import type { Prescription } from '../../../packages/domain/src/schema';
import { Icon } from './Icon';
import styles from './MovementPicker.module.css';

/** Ranked fields for the exercise picker and the settings search: the name first, then aliases, the family head, equipment. */
export const movementSearchFields = (catalogue: Catalogue) => (record: Movement) => [
  { text: record.name, weight: 3 },
  { text: [record.shortName ?? '', ...(record.aliases ?? [])].join(' '), weight: 2 },
  { text: record.family ? catalogue.head(record).name : '', weight: 1.5 },
  { text: (record.equipment ?? []).join(' '), weight: 1 },
];

interface MovementPickerProps {
  value: Prescription;
  label: string;
  catalogue: Catalogue;
  invalid?: boolean;
  onChange: (change: (current: Prescription) => Prescription) => void;
  /** Called with the picked record's equipment so the workout can declare it. */
  onPick?: (record: Movement) => void;
  /** Adds the typed name to the catalogue; returns the new record. */
  onAdd: (name: string) => Movement;
}

/** The movement name input with an exercise picker: type, arrow down, Enter. Picking fills the names and links the record. */
export function MovementPicker({ value, label, catalogue, invalid, onChange, onPick, onAdd }: MovementPickerProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const record = catalogue.resolve(value);
  const query = value.name.trim();
  const options = useMemo(() => open && query ? rankBySearch(catalogue.records, query, movementSearchFields(catalogue), 10) : [], [catalogue, open, query]);
  const unmatched = Boolean(query) && !record;

  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const pick = (picked: Movement) => {
    onChange(current => {
      const { shortName: _s, spokenName: _v, ...rest } = current;
      return { ...rest, movement: picked.id, name: picked.name, ...(picked.shortName ? { shortName: picked.shortName } : {}), ...(picked.spokenName ? { spokenName: picked.spokenName } : {}) };
    });
    onPick?.(picked);
    setOpen(false);
  };
  const add = () => { const created = onAdd(query); pick(created); };

  return <div ref={root} className={styles.picker} data-unmatched={unmatched || undefined}>
    <input
      role="combobox" aria-label={label} aria-autocomplete="list" aria-expanded={open && options.length > 0} aria-controls={listId} aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
      value={value.name} maxLength={160} placeholder="Movement" autoComplete="off" aria-invalid={invalid || undefined}
      onChange={event => { const name = event.target.value; onChange(current => { const { movement: _m, ...rest } = current; return { ...rest, name }; }); }}
      onBlur={() => setOpen(false)}
      onKeyDown={event => {
        if (event.key.length === 1 || event.key === 'Backspace') setOpen(true);
        if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive(index => Math.min(index + 1, Math.max(options.length - 1, 0))); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(index - 1, 0)); }
        else if (event.key === 'Enter' && open && options[active]) { event.preventDefault(); pick(options[active]); }
        else if (event.key === 'Escape') setOpen(false);
      }} />
    {open && options.length > 0 && <ul id={listId} role="listbox" className={styles.list} aria-label={`Exercises matching ${query}`}>
      {options.map((option, index) => {
        const head = option.family ? catalogue.head(option) : undefined;
        return <li key={option.id} id={`${listId}-${index}`} role="option" aria-selected={index === active} data-active={index === active} onPointerDown={event => event.preventDefault()} onClick={() => pick(option)} onPointerEnter={() => setActive(index)}>
          <span className={styles.optionName}>{option.name}</span>
          <small>{[head && head.id !== option.id ? `${head.name} variant` : '', ...(option.equipment ?? [])].filter(Boolean).join(' · ') || 'Bodyweight'}</small>
        </li>;
      })}
    </ul>}
    <div className={styles.status} aria-live="polite">
      {record ? <span className={styles.matched}><Icon name="check" size={12} />{record.name}{record.equipment?.length ? ` · ${record.equipment.join(', ')}` : ''}</span>
        : unmatched ? <span className={styles.unmatchedNote}><Icon name="alert" size={12} />Not in your exercises<button type="button" onClick={add} aria-label={`Add ${query} to exercises`}>Add</button></span>
        : null}
    </div>
  </div>;
}
