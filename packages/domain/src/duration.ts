/** Human-readable durations for workout files. The internal model always uses integer milliseconds. */

const UNIT_PATTERN = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/;
const CLOCK_PATTERN = /^(\d+):(\d{2})(?::(\d{2}))?$/;
const MS_PATTERN = /^(\d+)ms$/;

/** Accepts "40s", "2m", "1m30s", "1h", "1:30", "1:02:03", "500ms", or a number of seconds. Returns integer milliseconds. */
export function parseDuration(value: unknown): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) throw new Error('Durations must be zero or more seconds.');
    return Math.round(value * 1000);
  }
  if (typeof value !== 'string') throw new Error('Durations are written like 40s, 2m, 1m30s or 1:30.');
  const text = value.trim();
  const ms = MS_PATTERN.exec(text);
  if (ms) return Number(ms[1]);
  const clock = CLOCK_PATTERN.exec(text);
  if (clock) {
    const [, first, second, third] = clock;
    const [hours, minutes, seconds] = third === undefined ? [0, Number(first), Number(second)] : [Number(first), Number(second), Number(third)];
    if (minutes > 59 && third !== undefined) throw new Error(`"${value}" has more than 59 minutes; write hours as 1:05:00.`);
    if (seconds > 59) throw new Error(`"${value}" has more than 59 seconds; write 1:30 or 90s.`);
    return (hours * 3600 + minutes * 60 + seconds) * 1000;
  }
  const units = text && UNIT_PATTERN.exec(text);
  if (!units || units[0] === '') throw new Error(`"${value}" is not a duration. Write it like 40s, 2m, 1m30s or 1:30.`);
  const [, hours = '0', minutes = '0', seconds = '0'] = units;
  return Math.round((Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)) * 1000);
}

/** The shortest unit form that reads naturally: 40000 → "40s", 90000 → "1m30s", 3600000 → "1h", 1500 → "1.5s". */
export function formatDuration(ms: number): string {
  if (!Number.isInteger(ms) || ms < 0) throw new Error('Durations are stored as non-negative integer milliseconds.');
  if (ms === 0) return '0s';
  if (ms % 1000 !== 0) return `${Number((ms / 1000).toFixed(3))}s`;
  const total = ms / 1000;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${hours ? `${hours}h` : ''}${minutes ? `${minutes}m` : ''}${seconds ? `${seconds}s` : ''}`;
}
