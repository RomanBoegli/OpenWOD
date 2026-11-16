import { useEffect, useState, type InputHTMLAttributes } from 'react';

/** What a number field keeps while typing: digits and, for decimals, at most one point; a comma counts as the point. */
export function cleanNumberText(text: string, decimal: boolean): string {
  if (!decimal) return text.replace(/\D/g, '');
  const kept = text.replace(/,/g, '.').replace(/[^\d.]/g, '');
  const point = kept.indexOf('.');
  return point < 0 ? kept : `${kept.slice(0, point + 1)}${kept.slice(point + 1).replace(/\./g, '')}`;
}

/** The number a text means, "1." and ".5" included; undefined while it is empty or only a point. */
export function parseNumberText(text: string): number | undefined {
  return /^(\d+\.?\d*|\.\d+)$/.test(text) ? Number(text) : undefined;
}

/** One step of an arrow key from `value` to the next multiple of `step`; a step that would leave the bounds is not taken. */
export function stepNumber(value: number, direction: 1 | -1, step: number, min: number, max: number): number {
  // Counted with a little slack and rounded, so a step of 0.1 from 0.2 lands on 0.3 and not beside it.
  const units = value / step;
  const stepped = Number(((direction > 0 ? Math.floor(units + 1e-9) + 1 : Math.ceil(units - 1e-9) - 1) * step).toFixed(6));
  return stepped < min || stepped > max ? value : stepped;
}

type NumberInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'inputMode' | 'min' | 'max' | 'step'> & {
  value: number | '';
  onChange: (value: number | '') => void;
  min?: number;
  max?: number;
  /** Takes a decimal point or comma; without it the field holds whole numbers. */
  decimal?: boolean;
  /** The step of the arrow keys. */
  step?: number;
  /** An empty field is a value of its own and is reported as ''. */
  allowEmpty?: boolean;
};

/**
 * A number field that keeps its own text, so the model never receives a half-typed number. It takes digits and, for
 * decimals, one point or comma, reports a value only when the text is a number within the bounds, and shows the model's
 * value again when it loses focus. A native number field cannot do this: WebKit reports "1." as empty and its keypad
 * has no comma. While focused, the arrow keys step it.
 */
export function NumberInput({ value, onChange, min = 0, max = 999_999, decimal = false, step = 1, allowEmpty = false, onBlur, onKeyDown, 'aria-invalid': flagged, ...rest }: NumberInputProps) {
  const shown = (amount: number | '') => amount === '' ? '' : String(amount);
  const [text, setText] = useState(() => shown(value));
  // A value changed from outside replaces the text, unless the text already means that value.
  useEffect(() => { setText(current => (value === '' ? current === '' : parseNumberText(current) === value) ? current : shown(value)); }, [value]);
  const parsed = parseNumberText(text);
  const invalid = text !== '' ? parsed === undefined || parsed < min || parsed > max : !allowEmpty;

  const stepBy = (direction: 1 | -1) => {
    const from = value === '' ? 0 : value;
    const next = stepNumber(from, direction, step, min, max);
    if (next === from) return;
    setText(shown(next));
    onChange(next);
  };

  return <input {...rest} type="text" inputMode={decimal ? 'decimal' : 'numeric'} autoComplete="off" value={text} aria-invalid={invalid || flagged || undefined}
    onChange={event => {
      const clean = cleanNumberText(event.target.value, decimal);
      setText(clean);
      if (clean === '') { if (allowEmpty) onChange(''); return; }
      const amount = parseNumberText(clean);
      if (amount !== undefined && amount >= min && amount <= max) onChange(amount);
    }}
    onKeyDown={event => {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); stepBy(event.key === 'ArrowUp' ? 1 : -1); }
      onKeyDown?.(event);
    }}
    onBlur={event => { setText(shown(value)); onBlur?.(event); }} />;
}
