import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { keepFocus, nameKey as key, nearName, suggest, useListBelow } from './suggestions';
import { Icon } from './Icon';
import styles from './TagPicker.module.css';

interface TagPickerProps { label: string; value: string[]; options: string[]; onChange: (next: string[]) => void }
type Choice = { kind: 'pick' | 'new'; text: string };

/**
 * A list of names picked from a repertoire: type to get ranked suggestions, Enter or a comma takes the highlighted one,
 * and a name the repertoire lacks is offered as "Add …" so new entries are created in place. Backspace on an empty
 * input removes the last chip. Used wherever the app keeps a repertoire (equipment today, whose names are written in
 * Title Case: "Pull-Up Bar", so a phone capitalises every word).
 */
export function TagPicker({ label, value, options, onChange }: TagPickerProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const field = useRef<HTMLDivElement>(null);
  const chosen = new Set(value.map(key));
  const free = options.filter(option => !chosen.has(key(option)));
  /** The ranked matches for a text, then the text itself as a new name when the repertoire and the chips lack it. */
  const choicesFor = (text: string): Choice[] => [...suggest(free, text).map(match => ({ kind: 'pick' as const, text: match })), ...(text.trim() && !options.some(option => key(option) === key(text)) && !chosen.has(key(text)) ? [{ kind: 'new' as const, text: text.trim() }] : [])];
  const choices = choicesFor(query);
  const near = nearName(options, query);
  const current = Math.min(active, Math.max(choices.length - 1, 0));
  const showing = open && choices.length > 0;
  const anchor = useListBelow(field, showing, value.length);

  /** Takes the choices as chips and leaves `rest` in the field. The list closes, so a second Enter never adds the first option of the full list. */
  const commit = (taken: (Choice | undefined)[], rest = '') => {
    if (!taken.some(Boolean)) return;
    const next = [...value];
    for (const choice of taken) if (choice && !next.some(item => key(item) === key(choice.text))) next.push(choice.text);
    if (next.length > value.length) onChange(next);
    setQuery(rest); setActive(0); setOpen(Boolean(rest));
  };
  /**
   * A comma that arrives as text takes what stands before it, as the comma key does: Android keyboards and dictation
   * send no key for it, and a paste can bring several names at once. What follows the last comma stays in the field.
   */
  const onText = (text: string) => {
    if (!text.includes(',')) { setQuery(text); setOpen(true); setActive(0); return; }
    const names = text.split(',');
    const rest = names.pop()!.trimStart();
    // A comma straight after the query takes the highlighted choice; anything else its own best choice.
    commit(names.length === 1 && key(names[0]) === key(query) ? [query.trim() || open ? choices[current] : undefined] : names.filter(name => name.trim()).map(name => choicesFor(name)[0]), rest);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive(index => Math.min(index + 1, choices.length - 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(index - 1, 0)); }
    else if (event.key === 'Enter' || event.key === ',') { if (query.trim() || (open && choices.length)) { event.preventDefault(); commit([choices[current]]); } }
    else if (event.key === 'Backspace' && !query && value.length) onChange(value.slice(0, -1));
    else if (event.key === 'Escape') setOpen(false);
  };

  return <div className={styles.picker} role="group" aria-label={label}>
    <div ref={field} className={styles.field} onClick={event => { if (event.target === event.currentTarget) event.currentTarget.querySelector('input')?.focus(); }}>
      {value.map(item => <span key={item} className={styles.tag}>{item}<button type="button" aria-label={`Remove ${item}`} {...keepFocus} onClick={() => onChange(value.filter(known => known !== item))}><Icon name="close" size={12} /></button></span>)}
      <input role="combobox" aria-label={label} aria-expanded={open && choices.length > 0} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={open && choices.length ? `${listId}-${current}` : undefined} autoComplete="off" autoCorrect="off" autoCapitalize="words" spellCheck={false} value={query} maxLength={80}
        onChange={event => onText(event.target.value)} onBlur={() => setOpen(false)} onKeyDown={onKeyDown} />
    </div>
    {showing && anchor && <ul id={listId} role="listbox" className={styles.list} style={anchor} aria-label={`${label} suggestions`} {...keepFocus}>
      {choices.map((choice, index) => <li key={`${choice.kind}:${choice.text}`} id={`${listId}-${index}`} role="option" aria-selected={index === current} data-active={index === current} data-kind={choice.kind} onClick={() => commit([choice])} onPointerEnter={() => setActive(index)}>
        {choice.kind === 'new' ? <><Icon name="plus" size={13} />Add “{choice.text}”{near && <small>not “{near}”?</small>}</> : choice.text}
      </li>)}
    </ul>}
  </div>;
}
