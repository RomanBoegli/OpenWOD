import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { nameKey, nearName, suggest, useListBelow } from './suggestions';
import { Icon } from './Icon';
import styles from './TagPicker.module.css';

interface NamePickerProps { label: string; value: string; options: string[]; placeholder?: string; maxLength?: number; onChange: (next: string) => void }
type Choice = { kind: 'pick' | 'new'; text: string };

/**
 * One name picked from a repertoire or typed freely (the author of a workout today): typing ranks the known names,
 * Enter or a click takes the highlighted one, and a new name that is a typo away from a known one gets a nudge.
 */
export function NamePicker({ label, value, options, placeholder, maxLength = 160, onChange }: NamePickerProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const field = useRef<HTMLInputElement>(null);
  const typed = value.trim();
  const known = options.some(option => nameKey(option) === nameKey(typed));
  // The exact spelling already in the field is not offered again; another spelling of it is, so it can be taken over.
  const choices: Choice[] = [...suggest(options.filter(option => option !== typed), typed).map(text => ({ kind: 'pick' as const, text })), ...(typed && !known ? [{ kind: 'new' as const, text: typed }] : [])];
  const near = known ? undefined : nearName(options, typed);
  const current = Math.min(active, Math.max(choices.length - 1, 0));
  const showing = open && choices.length > 0;
  const anchor = useListBelow(field, showing);

  const take = (choice: Choice | undefined) => {
    if (choice?.kind === 'pick') onChange(choice.text);
    setOpen(false); setActive(0);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive(index => Math.min(index + 1, choices.length - 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(index - 1, 0)); }
    else if (event.key === 'Enter' && showing) { event.preventDefault(); take(choices[current]); }
    else if (event.key === 'Escape') setOpen(false);
  };

  return <div className={styles.picker}>
    <input ref={field} role="combobox" aria-label={label} aria-expanded={showing} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={showing ? `${listId}-${current}` : undefined} autoComplete="off" value={value} maxLength={maxLength} placeholder={placeholder}
      onChange={event => { onChange(event.target.value); setOpen(true); setActive(0); }} onBlur={() => setOpen(false)} onKeyDown={onKeyDown} />
    {showing && anchor && <ul id={listId} role="listbox" className={styles.list} style={anchor} aria-label={`${label} suggestions`}>
      {choices.map((choice, index) => <li key={`${choice.kind}:${choice.text}`} id={`${listId}-${index}`} role="option" aria-selected={index === current} data-active={index === current} data-kind={choice.kind} onPointerDown={event => event.preventDefault()} onClick={() => take(choice)} onPointerEnter={() => setActive(index)}>
        {choice.kind === 'new' ? <><Icon name="plus" size={13} />New: “{choice.text}”{near && <small>not “{near}”?</small>}</> : choice.text}
      </li>)}
    </ul>}
  </div>;
}
