import { useId, useRef } from 'react';
import { Icon } from '../Icon';
import styles from '../Settings.module.css';
import shared from '../App.module.css';

/** Ready-made choices as [#rrggbb or '' for the built-in colour, name]. */
export type ColorOptions = [string, string][];

/**
 * What a colour from the picker stands for. The ready-made choices are offered in the shade they produce, so one that
 * comes back as its shade is kept as its own value ('' for the built-in colour); any other colour is kept as picked.
 */
export function chosenColor(picked: string, options: ColorOptions, shade: (value: string) => string): string {
  const hex = picked.toLowerCase();
  const offered = options.find(([option]) => shade(option).toLowerCase() === hex);
  return offered ? offered[0] : hex;
}

interface Props {
  /** The accessible name, as in "Accent in the dark theme". */
  label: string;
  /** #rrggbb, or '' for the built-in colour. */
  value: string;
  /** The colour a choice will actually appear in, as #rrggbb; '' gives the built-in one. */
  shade: (value: string) => string;
  /** Ready-made choices: Chrome and Safari show them as swatches inside the picker, other browsers leave them out. */
  options?: ColorOptions;
  onChange: (value: string) => void;
}

const NO_OPTIONS: ColorOptions = [];

/**
 * One compact well for any colour setting. It shows the colour as it will appear and carries the platform's own picker,
 * laid invisibly over it, as that is the one picker every browser and device has. A chosen colour brings a button that
 * returns to the built-in one.
 */
export function ColorField({ label, value, shade, options = NO_OPTIONS, onChange }: Props) {
  const list = useId();
  const input = useRef<HTMLInputElement>(null);
  /** The picker opens on what it last returned, so it never jumps mid-drag: a ready-made choice in its shade (its swatch is then the marked one), any other colour as picked. */
  const start = !value || options.some(([option]) => option === value) ? shade(value) : value;
  return <span className={styles.colorField}>
    <span className={styles.colorWell} style={{ background: shade(value) }} title={label}><input ref={input} type="color" aria-label={label} list={options.length ? list : undefined} value={start} onChange={event => onChange(chosenColor(event.target.value, options, shade))} /></span>
    {/* The button leaves with the colour, so the focus moves to the well instead of being lost. */}
    {value && <button type="button" className={`${shared.iconButton} ${styles.colorReset}`} aria-label={`${label} back to the built-in colour`} title="Built-in colour" onClick={() => { onChange(''); input.current?.focus(); }}><Icon name="undo" size={14} /></button>}
    {options.length > 0 && <datalist id={list}>{options.map(([option, name]) => <option key={name} value={shade(option)} label={name} />)}</datalist>}
  </span>;
}
