import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { normalise } from '../../../packages/domain/src/library';
import { rankBySearch } from '../../../packages/domain/src/search';
import { Icon } from './Icon';
import styles from './TagPicker.module.css';

interface TagPickerProps { label: string; value: string[]; options: string[]; placeholder?: string; maxLength?: number; onChange: (next: string[]) => void }
type Choice = { kind: 'pick' | 'new'; text: string };

const key = (text: string) => normalise(text).replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * A list of names picked from a repertoire: type to get ranked suggestions, Enter or a comma takes the highlighted one,
 * and a name the repertoire lacks is offered as "Add …" so new entries are created in place. Backspace on an empty
 * input removes the last chip. Used wherever the app keeps a repertoire (equipment today).
 */
export function TagPicker({ label, value, options, placeholder, maxLength = 80, onChange }: TagPickerProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const field = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<CSSProperties>();
  const chosen = new Set(value.map(key));
  const free = options.filter(option => !chosen.has(key(option)));
  const matches = query.trim() ? rankBySearch(free, query, option => [{ text: option, weight: 1 }], 7) : free.slice(0, 7);
  const exact = options.find(option => key(option) === key(query));
  const choices: Choice[] = [...matches.map(text => ({ kind: 'pick' as const, text })), ...(query.trim() && !exact && !chosen.has(key(query)) ? [{ kind: 'new' as const, text: query.trim() }] : [])];
  const current = Math.min(active, Math.max(choices.length - 1, 0));
  const showing = open && choices.length > 0;
  // The list is fixed to the viewport (not absolute inside a dialog), so an open list never adds scroll height to its container.
  useLayoutEffect(() => {
    if (!showing || !field.current) { setAnchor(undefined); return; }
    const place = () => { const box = field.current!.getBoundingClientRect(); setAnchor({ position: 'fixed', top: box.bottom + 4, left: box.left, minWidth: Math.min(box.width, 360) }); };
    place();
    window.addEventListener('scroll', place, true); window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [showing, value.length]);

  const commit = (choice: Choice | undefined) => {
    if (!choice) return;
    if (!chosen.has(key(choice.text))) onChange([...value, choice.text]);
    setQuery(''); setActive(0);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive(index => Math.min(index + 1, choices.length - 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(index - 1, 0)); }
    else if (event.key === 'Enter' || event.key === ',') { if (query.trim() || (open && choices.length)) { event.preventDefault(); commit(choices[current]); } }
    else if (event.key === 'Backspace' && !query && value.length) onChange(value.slice(0, -1));
    else if (event.key === 'Escape') setOpen(false);
  };

  return <div className={styles.picker} role="group" aria-label={label}>
    <div ref={field} className={styles.field} onClick={event => { if (event.target === event.currentTarget) event.currentTarget.querySelector('input')?.focus(); }}>
      {value.map(item => <span key={item} className={styles.tag}>{item}<button type="button" aria-label={`Remove ${item}`} onPointerDown={event => { event.preventDefault(); onChange(value.filter(known => known !== item)); }} onClick={event => { if (event.detail === 0) onChange(value.filter(known => known !== item)); }}><Icon name="close" size={12} /></button></span>)}
      <input role="combobox" aria-label={label} aria-expanded={open && choices.length > 0} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={open && choices.length ? `${listId}-${current}` : undefined} autoComplete="off" value={query} maxLength={maxLength} placeholder={value.length ? '' : placeholder}
        onChange={event => { setQuery(event.target.value); setOpen(true); setActive(0); }} onBlur={() => setOpen(false)} onKeyDown={onKeyDown} />
    </div>
    {showing && anchor && <ul id={listId} role="listbox" className={styles.list} style={anchor} aria-label={`${label} suggestions`}>
      {choices.map((choice, index) => <li key={`${choice.kind}:${choice.text}`} id={`${listId}-${index}`} role="option" aria-selected={index === current} data-active={index === current} data-kind={choice.kind} onPointerDown={event => event.preventDefault()} onClick={() => commit(choice)} onPointerEnter={() => setActive(index)}>
        {choice.kind === 'new' ? <><Icon name="plus" size={13} />Add “{choice.text}”</> : choice.text}
      </li>)}
    </ul>}
  </div>;
}
