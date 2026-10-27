import type { BeepTone, CueSource, SoundMode } from './audio';
import type { LoadUnit, Sex } from '../../../packages/domain/src/prescription';
import { DEFAULT_CALIBRATION, normaliseCalibration, type DifficultyCalibration } from '../../../packages/domain/src/difficulty';
import { DARK_BACKGROUNDS, DEFAULT_BACKGROUND, LIGHT_BACKGROUNDS, type BackgroundChoice } from './theme';

export type ThemePreference = 'auto' | 'light' | 'dark';
export interface Preferences {
  theme: ThemePreference;
  names: { A: string; B: string };
  soundMode: SoundMode;
  cueSource: CueSource;
  rate: number;
  volume: number;
  /** The beeps' own level (0 to 1) and character, independent of the voice. */
  beepVolume: number;
  beepTone: BeepTone;
  view: 'focus' | 'context';
  /** The full-screen phase tint behind the timer. */
  wash: boolean;
  /** Recorded cue pack id, or '' for the first available. */
  cuePack: string;
  /** Whose amount each lane shows in a pair workout; solo workouts show both, women's in brackets. */
  loadsFor: { A: Sex; B: Sex };
  /** Absolute loads are shown in this unit, converted when a workout is written in the other. */
  loadUnit: LoadUnit;
  /** Stroke width of the timer ring around the player, in pixels. */
  perimeterWidth: number;
  /** How strongly the background pulse deepens as a slot drains, in percent. */
  washGain: number;
  /** The remaining time at which the colour turns amber, then red (both still capped to the slot length). */
  amberMs: number;
  redMs: number;
  /** Colours of the two milestone markers as #rrggbb, or '' for the theme's amber and red. */
  markColors: { first: string; second: string };
  /** The accent colour per theme as #rrggbb, or '' for the built-in green. Each theme derives its tints from its own choice. */
  accent: { dark: string; light: string };
  /** The colour of rest and transition phases per theme as #rrggbb, or '' for the built-in blue. */
  restColor: { dark: string; light: string };
  /** How deep the dark theme's background is and how bright the light theme's: the neutrals take the accent's hue at this depth. */
  background: BackgroundChoice;
  /** The overall progress line across every section and round: hidden, a bar, a bar with the numbers, or those plus a percentage beside the clock. */
  progress: 'off' | 'bar' | 'detail' | 'percent';
  /** The big clock's digits. */
  clockWeight: 'bold' | 'light';
  clockSize: 'large' | 'compact';
  /** How far the skip buttons and the J and L keys move the clock, in seconds. */
  nudgeSeconds: number;
  /** Equipment available at home; the library can hide anything that needs more. */
  myEquipment: string[];
  onlyMyEquipment: boolean;
  /** The knobs of the projected difficulty, so the ratings can be calibrated to the person reading them. */
  difficulty: DifficultyCalibration;
}

export const defaultPreferences: Preferences = { theme: 'auto', names: { A: 'Athlete A', B: 'Athlete B' }, soundMode: 'voice', cueSource: 'clips', rate: 1, volume: .7, beepVolume: .7, beepTone: 'classic', view: 'focus', wash: true, cuePack: '', loadsFor: { A: 'men', B: 'men' }, loadUnit: 'kg', perimeterWidth: 6, washGain: 30, amberMs: 10_000, redMs: 3000, markColors: { first: '', second: '' }, accent: { dark: '', light: '' }, restColor: { dark: '', light: '' }, background: DEFAULT_BACKGROUND, progress: 'detail', clockWeight: 'bold', clockSize: 'large', nudgeSeconds: 10, myEquipment: [], onlyMyEquipment: false, difficulty: DEFAULT_CALIBRATION };

const KEY = 'openwod.preferences.v1';
/** The theme is also stored on its own so index.html can apply it before the first paint. */
export const THEME_KEY = 'openwod.theme';

const clamp = (value: unknown, min: number, max: number, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const text = (value: unknown, fallback: string, max = 30) => typeof value === 'string' && value.trim() ? value.slice(0, max) : fallback;
const color = (value: unknown) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : '';
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T => (options as readonly string[]).includes(value as string) ? value as T : fallback;

/** Browser storage is a convenience: every read is validated and any failure yields the defaults. */
export function loadPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(KEY);
    const stored = raw ? JSON.parse(raw) as Partial<Preferences> & { names?: Partial<Preferences['names']>; loadsFor?: Partial<Preferences['loadsFor']>; markColors?: Partial<Preferences['markColors']>; accent?: string | Partial<Preferences['accent']>; restColor?: Partial<Preferences['restColor']>; background?: Partial<BackgroundChoice> } : {};
    return {
      theme: oneOf(stored.theme, ['auto', 'light', 'dark'], defaultPreferences.theme),
      names: { A: text(stored.names?.A, defaultPreferences.names.A), B: text(stored.names?.B, defaultPreferences.names.B) },
      soundMode: oneOf(stored.soundMode, ['voice', 'beeps', 'silent'], defaultPreferences.soundMode),
      cueSource: oneOf(stored.cueSource, ['clips', 'device'], defaultPreferences.cueSource),
      rate: clamp(stored.rate, .7, 1.3, defaultPreferences.rate),
      volume: clamp(stored.volume, 0, 1, defaultPreferences.volume),
      // Before 1.1.0 one level served voice and beeps; the beeps start from that level.
      beepVolume: clamp(stored.beepVolume, 0, 1, clamp(stored.volume, 0, 1, defaultPreferences.beepVolume)),
      beepTone: oneOf(stored.beepTone, ['classic', 'soft', 'sharp', 'gym', 'alarm'], defaultPreferences.beepTone),
      view: oneOf(stored.view, ['focus', 'context'], defaultPreferences.view),
      wash: stored.wash !== false,
      cuePack: text(stored.cuePack, '', 40),
      loadsFor: { A: oneOf(stored.loadsFor?.A, ['men', 'women'], 'men'), B: oneOf(stored.loadsFor?.B, ['men', 'women'], 'men') },
      loadUnit: oneOf(stored.loadUnit, ['kg', 'lb'], 'kg'),
      perimeterWidth: Math.round(clamp(stored.perimeterWidth, 3, 12, defaultPreferences.perimeterWidth)),
      washGain: Math.round(clamp(stored.washGain, 10, 60, defaultPreferences.washGain)),
      amberMs: Math.round(clamp(stored.amberMs, 5000, 30_000, defaultPreferences.amberMs)),
      redMs: Math.min(Math.round(clamp(stored.redMs, 1000, 10_000, defaultPreferences.redMs)), Math.round(clamp(stored.amberMs, 5000, 30_000, defaultPreferences.amberMs))),
      markColors: { first: color(stored.markColors?.first), second: color(stored.markColors?.second) },
      // Before 1.1.0 one accent served both themes; that choice carries over to each.
      accent: typeof stored.accent === 'string' ? { dark: color(stored.accent), light: color(stored.accent) } : { dark: color(stored.accent?.dark), light: color(stored.accent?.light) },
      restColor: { dark: color(stored.restColor?.dark), light: color(stored.restColor?.light) },
      background: { dark: oneOf(stored.background?.dark, DARK_BACKGROUNDS, DEFAULT_BACKGROUND.dark), light: oneOf(stored.background?.light, LIGHT_BACKGROUNDS, DEFAULT_BACKGROUND.light) },
      progress: oneOf(stored.progress, ['off', 'bar', 'detail', 'percent'], 'detail'),
      clockWeight: oneOf(stored.clockWeight, ['bold', 'light'], 'bold'),
      clockSize: oneOf(stored.clockSize, ['large', 'compact'], 'large'),
      nudgeSeconds: Math.round(clamp(stored.nudgeSeconds, 1, 60, defaultPreferences.nudgeSeconds)),
      myEquipment: Array.isArray(stored.myEquipment) ? stored.myEquipment.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 60).map(item => item.slice(0, 80)) : [],
      onlyMyEquipment: stored.onlyMyEquipment === true,
      difficulty: normaliseCalibration(stored.difficulty),
    };
  } catch { return structuredClone(defaultPreferences); }
}

export function savePreferences(preferences: Preferences) {
  try {
    localStorage.setItem(KEY, JSON.stringify(preferences));
    localStorage.setItem(THEME_KEY, preferences.theme);
  } catch { /* Storage may be unavailable or full; preferences then last for this visit only. */ }
}
