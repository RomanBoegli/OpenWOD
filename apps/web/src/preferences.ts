import type { BeepTone, CueSource, SoundMode } from './audio';
import type { LoadUnit, Sex } from '../../../packages/domain/src/prescription';
import { DEFAULT_CALIBRATION, normaliseCalibration, type DifficultyCalibration } from '../../../packages/domain/src/difficulty';
import { equipmentName } from '../../../packages/domain/src/library';
import { DARK_BACKGROUNDS, DEFAULT_BACKGROUND, LIGHT_BACKGROUNDS, type BackgroundChoice } from './theme';

export type ThemePreference = 'auto' | 'light' | 'dark';
export interface Preferences {
  theme: ThemePreference;
  names: { A: string; B: string };
  soundMode: SoundMode;
  cueSource: CueSource;
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
  /** Colours of the two milestone markers per theme as #rrggbb, or '' for the theme's amber and red. */
  markColors: { first: { dark: string; light: string }; second: { dark: string; light: string } };
  /** The colour of a paused session per theme as #rrggbb, or '' for the theme's own. */
  pauseColor: { dark: string; light: string };
  /** The accent colour per theme as #rrggbb, or '' for the built-in green. Each theme derives its tints from its own choice. */
  accent: { dark: string; light: string };
  /** The colour of rest and transition phases per theme as #rrggbb, or '' for the built-in blue. */
  restColor: { dark: string; light: string };
  /** How deep the dark theme's background is and how bright the light theme's: the neutrals take the accent's hue at this depth. */
  background: BackgroundChoice;
  /** What the player shows of the session's progress, each part on its own: the bar across every section and round, the percentage under it, the percentage beside the clock and the round donut. */
  progress: { bar: boolean; barPercent: boolean; clockPercent: boolean; donut: boolean };
  /** How far the skip buttons and the J and L keys move the clock, in seconds. */
  nudgeSeconds: number;
  /** Equipment available at home; the library can hide anything that needs more. */
  myEquipment: string[];
  onlyMyEquipment: boolean;
  /** The knobs of the projected difficulty, so the ratings can be calibrated to the person reading them. */
  difficulty: DifficultyCalibration;
}

export const defaultPreferences: Preferences = { theme: 'auto', names: { A: 'Athlete A', B: 'Athlete B' }, soundMode: 'voice', cueSource: 'clips', volume: .7, beepVolume: .7, beepTone: 'classic', view: 'focus', wash: true, cuePack: '', loadsFor: { A: 'men', B: 'men' }, loadUnit: 'kg', perimeterWidth: 6, washGain: 30, amberMs: 10_000, redMs: 3000, markColors: { first: { dark: '', light: '' }, second: { dark: '', light: '' } }, pauseColor: { dark: '', light: '' }, accent: { dark: '', light: '' }, restColor: { dark: '', light: '' }, background: DEFAULT_BACKGROUND, progress: { bar: true, barPercent: true, clockPercent: false, donut: true }, nudgeSeconds: 10, myEquipment: [], onlyMyEquipment: false, difficulty: DEFAULT_CALIBRATION };

const KEY = 'openwod.preferences.v1';
/** The theme is also stored on its own so index.html can apply it before the first paint. */
const THEME_KEY = 'openwod.theme';

const clamp = (value: unknown, min: number, max: number, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const text = (value: unknown, fallback: string, max = 30) => typeof value === 'string' && value.trim() ? value.slice(0, max) : fallback;
const color = (value: unknown) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : '';
/** A colour per theme. A single stored colour is the shape from before each theme had its own, and carries over to both. */
const perTheme = (value: unknown) => { const stored = (value && typeof value === 'object' ? value : {}) as { dark?: unknown; light?: unknown }; return typeof value === 'string' ? { dark: color(value), light: color(value) } : { dark: color(stored.dark), light: color(stored.light) }; };
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T => (options as readonly string[]).includes(value as string) ? value as T : fallback;
/** Before 1.6.0 the progress was one of four looks: each as the parts the player showed for it, the donut always among them. */
const PROGRESS_LOOKS: Record<'off' | 'bar' | 'detail' | 'percent', Preferences['progress']> = {
  off: { bar: false, barPercent: false, clockPercent: false, donut: true },
  bar: { bar: true, barPercent: false, clockPercent: false, donut: true },
  detail: { bar: true, barPercent: true, clockPercent: false, donut: true },
  percent: { bar: true, barPercent: false, clockPercent: true, donut: true },
};
/** The parts of the progress: an old look by its name (an unknown one is the default look), otherwise part by part, each falling back to its default alone. */
const progressParts = (value: unknown): Preferences['progress'] => {
  if (typeof value === 'string') return { ...PROGRESS_LOOKS[oneOf(value, ['off', 'bar', 'detail', 'percent'], 'detail')] };
  const stored = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const part = (key: keyof Preferences['progress']) => { const on = stored[key]; return typeof on === 'boolean' ? on : defaultPreferences.progress[key]; };
  return { bar: part('bar'), barPercent: part('barPercent'), clockPercent: part('clockPercent'), donut: part('donut') };
};

/** Browser storage is a convenience: every read is validated and any failure yields the defaults. */
export function loadPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(KEY);
    return normalisePreferences(raw ? JSON.parse(raw) : {});
  } catch { return structuredClone(defaultPreferences); }
}

/** Validates stored preferences field by field, from this browser or from the household server: anything unknown falls back to its default. */
export function normalisePreferences(value: unknown): Preferences {
  try {
    const stored = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Partial<Preferences> & { names?: Partial<Preferences['names']>; loadsFor?: Partial<Preferences['loadsFor']>; markColors?: { first?: unknown; second?: unknown }; pauseColor?: unknown; accent?: unknown; restColor?: unknown; background?: Partial<BackgroundChoice> };
    return {
      theme: oneOf(stored.theme, ['auto', 'light', 'dark'], defaultPreferences.theme),
      names: { A: text(stored.names?.A, defaultPreferences.names.A), B: text(stored.names?.B, defaultPreferences.names.B) },
      soundMode: oneOf(stored.soundMode, ['voice', 'beeps', 'silent'], defaultPreferences.soundMode),
      cueSource: oneOf(stored.cueSource, ['clips', 'device'], defaultPreferences.cueSource),
      volume: clamp(stored.volume, 0, 1, defaultPreferences.volume),
      // Before 1.1.0 one level served voice and beeps; the beeps start from that level.
      beepVolume: clamp(stored.beepVolume, 0, 1, clamp(stored.volume, 0, 1, defaultPreferences.beepVolume)),
      beepTone: oneOf(stored.beepTone, ['classic', 'soft', 'sharp', 'gym', 'alarm', 'horn'], defaultPreferences.beepTone),
      view: oneOf(stored.view, ['focus', 'context'], defaultPreferences.view),
      wash: stored.wash !== false,
      cuePack: text(stored.cuePack, '', 40),
      loadsFor: { A: oneOf(stored.loadsFor?.A, ['men', 'women'], 'men'), B: oneOf(stored.loadsFor?.B, ['men', 'women'], 'men') },
      loadUnit: oneOf(stored.loadUnit, ['kg', 'lb'], 'kg'),
      perimeterWidth: Math.round(clamp(stored.perimeterWidth, 3, 12, defaultPreferences.perimeterWidth)),
      washGain: Math.round(clamp(stored.washGain, 10, 60, defaultPreferences.washGain)),
      amberMs: Math.round(clamp(stored.amberMs, 5000, 30_000, defaultPreferences.amberMs)),
      redMs: Math.min(Math.round(clamp(stored.redMs, 1000, 10_000, defaultPreferences.redMs)), Math.round(clamp(stored.amberMs, 5000, 30_000, defaultPreferences.amberMs))),
      // Before 1.6.0 one colour per marker served both themes; that choice carries over to each.
      markColors: { first: perTheme(stored.markColors?.first), second: perTheme(stored.markColors?.second) },
      pauseColor: perTheme(stored.pauseColor),
      // Before 1.1.0 one accent served both themes; that choice carries over to each.
      accent: perTheme(stored.accent),
      restColor: perTheme(stored.restColor),
      background: { dark: oneOf(stored.background?.dark, DARK_BACKGROUNDS, DEFAULT_BACKGROUND.dark), light: oneOf(stored.background?.light, LIGHT_BACKGROUNDS, DEFAULT_BACKGROUND.light) },
      progress: progressParts(stored.progress),
      nudgeSeconds: Math.round(clamp(stored.nudgeSeconds, 1, 60, defaultPreferences.nudgeSeconds)),
      myEquipment: Array.isArray(stored.myEquipment) ? stored.myEquipment.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 60).map(item => equipmentName(item.slice(0, 80))) : [],
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
