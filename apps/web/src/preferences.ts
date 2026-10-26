import type { CueSource, SoundMode } from './audio';
import type { Sex } from './master-data';

export type ThemePreference = 'auto' | 'light' | 'dark';
export interface Preferences {
  theme: ThemePreference;
  names: { A: string; B: string };
  soundMode: SoundMode;
  cueSource: CueSource;
  rate: number;
  volume: number;
  view: 'focus' | 'context';
  /** The full-screen phase tint behind the timer. */
  wash: boolean;
  /** Recorded cue pack id, or '' for the first available. */
  cuePack: string;
  /** Whose default loads each lane shows when the movement table knows a movement. */
  loadsFor: { A: Sex; B: Sex };
  /** Equipment available at home; the library can hide anything that needs more. */
  myEquipment: string[];
  onlyMyEquipment: boolean;
}

export const defaultPreferences: Preferences = { theme: 'auto', names: { A: 'Athlete A', B: 'Athlete B' }, soundMode: 'voice', cueSource: 'clips', rate: 1, volume: .7, view: 'focus', wash: true, cuePack: '', loadsFor: { A: 'men', B: 'men' }, myEquipment: [], onlyMyEquipment: false };

const KEY = 'openwod.preferences.v1';
const LEGACY_KEY = 'wodva.preferences.v1';
/** The theme is also stored on its own so index.html can apply it before the first paint. */
export const THEME_KEY = 'openwod.theme';

const clamp = (value: unknown, min: number, max: number, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const text = (value: unknown, fallback: string, max = 30) => typeof value === 'string' && value.trim() ? value.slice(0, max) : fallback;
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T => (options as readonly string[]).includes(value as string) ? value as T : fallback;

/** Browser storage is a convenience: every read is validated and any failure yields the defaults. */
export function loadPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY);
    const stored = raw ? JSON.parse(raw) as Partial<Preferences> & { names?: Partial<Preferences['names']>; loadsFor?: Partial<Preferences['loadsFor']> } : {};
    return {
      theme: oneOf(stored.theme, ['auto', 'light', 'dark'], defaultPreferences.theme),
      names: { A: text(stored.names?.A, defaultPreferences.names.A), B: text(stored.names?.B, defaultPreferences.names.B) },
      soundMode: oneOf(stored.soundMode, ['voice', 'beeps', 'silent'], defaultPreferences.soundMode),
      cueSource: oneOf(stored.cueSource, ['clips', 'device'], defaultPreferences.cueSource),
      rate: clamp(stored.rate, .7, 1.3, defaultPreferences.rate),
      volume: clamp(stored.volume, 0, 1, defaultPreferences.volume),
      view: oneOf(stored.view, ['focus', 'context'], defaultPreferences.view),
      wash: stored.wash !== false,
      cuePack: text(stored.cuePack, '', 40),
      loadsFor: { A: oneOf(stored.loadsFor?.A, ['men', 'women'], 'men'), B: oneOf(stored.loadsFor?.B, ['men', 'women'], 'men') },
      myEquipment: Array.isArray(stored.myEquipment) ? stored.myEquipment.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 60).map(item => item.slice(0, 80)) : [],
      onlyMyEquipment: stored.onlyMyEquipment === true,
    };
  } catch { return structuredClone(defaultPreferences); }
}

export function savePreferences(preferences: Preferences) {
  try {
    localStorage.setItem(KEY, JSON.stringify(preferences));
    localStorage.setItem(THEME_KEY, preferences.theme);
  } catch { /* Storage may be unavailable or full; preferences then last for this visit only. */ }
}
