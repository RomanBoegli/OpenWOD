import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';

/** What a time field keeps while typing: digits and at most one colon, so letters never land in it. */
export function cleanTimeText(text: string): string {
  const kept = text.replace(/[^\d:]/g, '');
  const colon = kept.indexOf(':');
  return colon < 0 ? kept : `${kept.slice(0, colon + 1)}${kept.slice(colon + 1).replace(/:/g, '')}`;
}

/** m:ss, mm:ss or plain seconds as milliseconds; undefined while the text is empty, incomplete or has 60 seconds or more after the colon. */
export function parseTimeText(text: string): number | undefined {
  if (/^\d{1,5}$/.test(text)) return Number(text) * 1000;
  const match = /^(\d{0,3}):(\d{1,2})$/.exec(text);
  if (!match || Number(match[2]) >= 60) return undefined;
  return (Number(match[1] || 0) * 60 + Number(match[2])) * 1000;
}

/** Milliseconds as mm:ss, whole seconds rounded down. */
export function formatTimeText(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/** One step of the wheel or an arrow key from `value`, kept within the bounds. */
export function stepTime(value: number, direction: 1 | -1, stepMs: number, min: number, max: number): number {
  const stepped = direction > 0 ? Math.floor(value / stepMs) * stepMs + stepMs : Math.ceil(value / stepMs) * stepMs - stepMs;
  return Math.min(max, Math.max(min, stepped));
}

type TimeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'min' | 'max' | 'step'> & {
  value: number;
  onChange: (ms: number) => void;
  min?: number;
  max?: number;
  /** The step of the wheel and the arrow keys; Shift steps a minute. */
  stepMs?: number;
  /** An empty field means 0 and shows the placeholder. */
  allowEmpty?: boolean;
};

/**
 * A time field in mm:ss. It takes digits and one colon only, reports a value only when the text is a valid time, and
 * tidies the text to mm:ss when it loses focus. While focused, the wheel and the arrow keys step it.
 */
export function TimeInput({ value, onChange, min = 0, max = 999 * 60_000 + 59_000, stepMs = 5000, allowEmpty = false, onBlur, onKeyDown, ...rest }: TimeInputProps) {
  const shown = (ms: number) => allowEmpty && !ms ? '' : formatTimeText(ms);
  const [text, setText] = useState(() => shown(value));
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef({ value, onChange, min, max, stepMs });
  latest.current = { value, onChange, min, max, stepMs };
  // A value changed from outside replaces the text, unless the text already means that value.
  useEffect(() => { setText(current => parseTimeText(current) === value || (allowEmpty && !value && !current) ? current : shown(value)); }, [value, allowEmpty]);
  const parsed = parseTimeText(text);
  const invalid = text !== '' ? parsed === undefined || parsed < min || parsed > max : !allowEmpty;

  const step = (direction: 1 | -1, minute: boolean) => {
    const { value: current, onChange: report, min: low, max: high, stepMs: size } = latest.current;
    const next = stepTime(current, direction, minute ? 60_000 : size, low, high);
    setText(formatTimeText(next));
    if (next !== current) report(next);
  };
  // React's wheel listener is passive, so the page would scroll too; this one can keep the wheel for the field.
  useEffect(() => {
    const element = input.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (document.activeElement !== element || event.deltaY === 0) return;
      event.preventDefault();
      step(event.deltaY < 0 ? 1 : -1, event.shiftKey);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);

  return <input {...rest} ref={input} inputMode="numeric" autoComplete="off" value={text} aria-invalid={invalid || undefined}
    onChange={event => {
      const clean = cleanTimeText(event.target.value);
      setText(clean);
      if (allowEmpty && clean === '') { onChange(0); return; }
      const ms = parseTimeText(clean);
      if (ms !== undefined && ms >= min && ms <= max) onChange(ms);
    }}
    onKeyDown={event => {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); step(event.key === 'ArrowUp' ? 1 : -1, event.shiftKey); }
      onKeyDown?.(event);
    }}
    onBlur={event => { setText(shown(latest.current.value)); onBlur?.(event); }} />;
}
