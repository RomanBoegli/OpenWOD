import type { Theme } from '../theme';
import styles from '../Settings.module.css';

interface Props {
  /** Prefix of the per-theme label ids. */
  id: string;
  /** The thing being coloured, as in "Accent in the dark theme". */
  label: string;
  /** Ready-made choices as [#rrggbb or '' for the built-in colour, name]. */
  options: [string, string][];
  value: Record<Theme, string>;
  /** The shade a theme will actually show for a choice, so the swatch matches the result. */
  shade: (value: string, theme: Theme) => string;
  onChange: (value: Record<Theme, string>) => void;
}

/** One swatch row per theme: the ready-made choices in the shade that theme will show, plus a picker for any colour. */
export function ColorChoice({ id, label, options, value, shade, onChange }: Props) {
  return <>{(['dark', 'light'] as const).map(theme => <div key={theme} className={styles.field}><span id={`${id}-${theme}-label`}>{label} in the {theme} theme</span>
    <div className={styles.swatches} role="group" aria-labelledby={`${id}-${theme}-label`}>
      {options.map(([option, name]) => <button key={name} type="button" className={styles.swatch} style={{ background: shade(option, theme) }} aria-label={name} aria-pressed={value[theme] === option} title={name} onClick={() => onChange({ ...value, [theme]: option })} />)}
      <label className={styles.swatchPicker} title="Any colour"><input type="color" aria-label={`Custom ${label.toLowerCase()} for the ${theme} theme`} value={value[theme] || shade('', theme)} onChange={event => onChange({ ...value, [theme]: event.target.value.toLowerCase() })} /><span>Custom</span></label>
    </div>
  </div>)}</>;
}
