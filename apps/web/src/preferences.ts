import type { CueSource, SoundMode } from './audio';

export type ThemePreference = 'auto' | 'light' | 'dark';
export interface Preferences {
  theme: ThemePreference;
  names: { A: string; B: string };
  soundMode: SoundMode;
  cueSource: CueSource;
  voiceURI: string;
  rate: number;
  volume: number;
  view: 'focus' | 'context';
}

export const defaultPreferences: Preferences = { theme: 'auto', names: { A: 'Athlete A', B: 'Athlete B' }, soundMode: 'voice', cueSource: 'clips', voiceURI: '', rate: 1, volume: .7, view: 'focus' };

const KEY = 'wodva.preferences.v1';
/** The theme is also stored on its own so index.html can apply it before the first paint. */
export const THEME_KEY = 'wodva.theme';

const clamp = (value: unknown, min: number, max: number, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const text = (value: unknown, fallback: string, max = 30) => typeof value === 'string' && value.trim() ? value.slice(0, max) : fallback;
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T => (options as readonly string[]).includes(value as string) ? value as T : fallback;

/** Browser storage is a convenience: every read is validated and any failure yields the defaults. */
export function loadPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(KEY);
    const stored = raw ? JSON.parse(raw) as Partial<Preferences> & { names?: Partial<Preferences['names']> } : {};
    return {
      theme: oneOf(stored.theme, ['auto', 'light', 'dark'], defaultPreferences.theme),
      names: { A: text(stored.names?.A, defaultPreferences.names.A), B: text(stored.names?.B, defaultPreferences.names.B) },
      soundMode: oneOf(stored.soundMode, ['voice', 'beeps', 'silent'], defaultPreferences.soundMode),
      cueSource: oneOf(stored.cueSource, ['clips', 'device'], defaultPreferences.cueSource),
      voiceURI: text(stored.voiceURI, '', 300),
      rate: clamp(stored.rate, .7, 1.3, defaultPreferences.rate),
      volume: clamp(stored.volume, 0, 1, defaultPreferences.volume),
      view: oneOf(stored.view, ['focus', 'context'], defaultPreferences.view),
    };
  } catch { return structuredClone(defaultPreferences); }
}

export function savePreferences(preferences: Preferences) {
  try {
    localStorage.setItem(KEY, JSON.stringify(preferences));
    localStorage.setItem(THEME_KEY, preferences.theme);
  } catch { /* Storage may be unavailable or full; preferences then last for this visit only. */ }
}
