import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Catalogue, Movement } from '../../../packages/domain/src/catalogue';
import { rankBySearch } from '../../../packages/domain/src/search';
import type { Prescription } from '../../../packages/domain/src/schema';
import { Icon } from './Icon';
import { keepFocus } from './suggestions';
import styles from './MovementPicker.module.css';

/** Ranked fields for the movement picker and the settings search: the name first, then aliases, the family head, equipment. */
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
  /** Adds the typed name to the catalogue; returns the new record. */
  onAdd: (name: string) => Movement;
}

/** The movement name input with a catalogue picker: type, arrow down, Enter. Picking fills the names and links the record. */
export function MovementPicker({ value, label, catalogue, invalid, onChange, onAdd }: MovementPickerProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  /** Whether the name was typed since the field took the focus: only then does leaving it settle the spelling. */
  const typed = useRef(false);
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
    typed.current = false;
    onChange(current => {
      const { shortName: _s, spokenName: _v, ...rest } = current;
      return { ...rest, movement: picked.id, name: picked.name, ...(picked.shortName ? { shortName: picked.shortName } : {}), ...(picked.spokenName ? { spokenName: picked.spokenName } : {}) };
    });
    setOpen(false);
  };
  const add = () => { const created = onAdd(query); pick(created); };
  /**
   * A retyped name is another movement: the link goes, and with it the short and spoken names of the picked record. Any
   * change of the text opens the list; Android keyboards, dictation, swipe typing and a paste send no printable key.
   */
  const rename = (name: string) => { typed.current = true; setOpen(true); onChange(current => { const { movement: _m, shortName: _s, spokenName: _v, ...rest } = current; return { ...rest, name }; }); };
  /**
   * Leaving the field settles a typed name the catalogue knows on the catalogue's spelling ("romanian deadlifts" →
   * "Romanian Deadlifts"), so the lane reads like the others and gets the record's recorded voice. A name of a record
   * is picked whole; an alias keeps being the alias. Never while typing: "burpee" may still become "burpee box jumps".
   */
  const settle = () => {
    setOpen(false);
    if (!typed.current) return;
    typed.current = false;
    const known = catalogue.byName(value.name);
    const spelling = catalogue.spelling(value.name);
    if (!known || !spelling) return;
    if (spelling === known.name) pick(known);
    else onChange(current => ({ ...current, movement: known.id, name: spelling }));
  };

  return <div ref={root} className={styles.picker} data-unmatched={unmatched || undefined}>
    <input
      role="combobox" aria-label={label} aria-autocomplete="list" aria-expanded={open && options.length > 0} aria-controls={listId} aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
      value={value.name} maxLength={160} placeholder="Movement" autoComplete="off" autoCorrect="off" autoCapitalize="words" spellCheck={false} aria-invalid={invalid || undefined}
      onChange={event => rename(event.target.value)}
      onBlur={settle}
      onKeyDown={event => {
        if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive(index => Math.min(index + 1, Math.max(options.length - 1, 0))); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(index - 1, 0)); }
        else if (event.key === 'Enter' && open && options[active]) { event.preventDefault(); pick(options[active]); }
        else if (event.key === 'Escape') setOpen(false);
      }} />
    {open && options.length > 0 && <ul id={listId} role="listbox" className={styles.list} aria-label={`Movements matching ${query}`} {...keepFocus}>
      {options.map((option, index) => {
        const head = option.family ? catalogue.head(option) : undefined;
        return <li key={option.id} id={`${listId}-${index}`} role="option" aria-selected={index === active} data-active={index === active} onClick={() => pick(option)} onPointerEnter={() => setActive(index)}>
          <span className={styles.optionName}>{option.name}</span>
          <small>{[head && head.id !== option.id ? `${head.name} variant` : '', ...(option.equipment ?? [])].filter(Boolean).join(' · ') || 'Bodyweight'}</small>
        </li>;
      })}
    </ul>}
    <div className={styles.status} aria-live="polite">
      {record ? <span className={styles.matched}><Icon name="check" size={12} />{record.name}{record.equipment?.length ? ` · ${record.equipment.join(', ')}` : ''}</span>
        : unmatched ? <span className={styles.unmatchedNote}><Icon name="alert" size={12} />Not in your catalogue<button type="button" onClick={add} aria-label={`Add ${query} to the catalogue`}>Add</button></span>
        : null}
    </div>
  </div>;
}
