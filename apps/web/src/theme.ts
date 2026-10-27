import { useEffect } from 'react';
import type { Preferences, ThemePreference } from './preferences';

export type Theme = 'light' | 'dark';
const THEME_COLOR: Record<Theme, string> = { dark: '#101613', light: '#f3f5ee' };

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): Theme {
  return preference === 'auto' ? (prefersDark ? 'dark' : 'light') : preference;
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
}

const ACCENT_TOKENS = ['--accent', '--accent-text', '--accent-fill', '--accent-fill-hover', '--accent-ink', '--accent-border', '--accent-soft', '--accent-track', '--focus', '--phase-work', '--brand-symbol', '--selection', '--selection-ink'] as const;

function hexToHsl(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d === 0) return [0, 0, l * 100];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100, light = l / 100;
  const f = (n: number) => { const k = (n + h / 30) % 12; const a = sat * Math.min(light, 1 - light); return Math.round(255 * (light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0'); };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Tints the whole accent family from one chosen colour: the dark theme wants a light, luminous accent, the light theme a
 * deep one that stays readable as text on the page. Only hue and saturation come from the choice, lightness is fixed per
 * theme so any colour keeps the contrast the built-in green was tuned for.
 */
export function accentTokens(hex: string, theme: Theme): Record<(typeof ACCENT_TOKENS)[number], string> {
  const [h, rawS] = hexToHsl(hex);
  const s = Math.min(85, Math.max(45, rawS));
  if (theme === 'dark') {
    const accent = hslToHex(h, s, 75), lighter = hslToHex(h, s, 81);
    return { '--accent': accent, '--accent-text': accent, '--accent-fill': accent, '--accent-fill-hover': lighter, '--accent-ink': hslToHex(h, 25, 9), '--accent-border': lighter, '--accent-soft': `${accent}10`, '--accent-track': `${accent}1e`, '--focus': lighter, '--phase-work': accent, '--brand-symbol': accent, '--selection': accent, '--selection-ink': hslToHex(h, 25, 9) };
  }
  const fill = hslToHex(h, s, 31), text = hslToHex(h, s, 27), accent = hslToHex(h, s, 34);
  return { '--accent': accent, '--accent-text': text, '--accent-fill': fill, '--accent-fill-hover': hslToHex(h, s, 37), '--accent-ink': '#ffffff', '--accent-border': fill, '--accent-soft': `${fill}14`, '--accent-track': `${fill}22`, '--focus': fill, '--phase-work': accent, '--brand-symbol': hslToHex(h, s, 40), '--selection': hslToHex(h, s, 78), '--selection-ink': hslToHex(h, 25, 9) };
}

const REST_TOKENS = ['--phase-rest'] as const;

/**
 * The rest colour of the player (rest and transition phases, the waiting lane) is tinted the same way: the built-in blue sits
 * at the lightness every choice is brought to, so a chosen hue keeps the contrast of the original in either theme.
 */
export function restTokens(hex: string, theme: Theme): Record<(typeof REST_TOKENS)[number], string> {
  const [h, rawS] = hexToHsl(hex);
  const s = Math.min(85, Math.max(45, rawS));
  return { '--phase-rest': hslToHex(h, s, theme === 'dark' ? 79 : 39) };
}

export type DarkBackground = 'black' | 'deep' | 'grey';
export type LightBackground = 'white' | 'paper' | 'grey';
export interface BackgroundChoice { dark: DarkBackground; light: LightBackground }
export const DARK_BACKGROUNDS: DarkBackground[] = ['black', 'deep', 'grey'];
export const LIGHT_BACKGROUNDS: LightBackground[] = ['white', 'paper', 'grey'];
export const DEFAULT_BACKGROUND: BackgroundChoice = { dark: 'deep', light: 'paper' };

const NEUTRAL_TOKENS = ['--bg', '--bg-glow', '--ink', '--ink-2', '--ink-3', '--ink-4', '--neutral-track', '--surface-1', '--surface-2', '--surface-3', '--surface-4', '--surface-5', '--input-bg', '--backdrop', '--brand-surface'] as const;
type NeutralToken = (typeof NEUTRAL_TOKENS)[number];
/** Saturation, lightness and an optional alpha suffix per token. */
type Spec = [number, number, string?];
type Ladder = Record<NeutralToken, Spec>;

/**
 * The page's neutrals (background and its glow, cards, inputs, the text greys, the dialog backdrop) as saturation and
 * lightness per background depth. Deep and Paper are the built-in values measured from the stylesheet, so the default
 * depth with a chosen accent only swaps the hue. Black and White push the extremes, Grey lifts the dark theme and dims
 * the light one, with the text greys moved to keep their contrast on it.
 */
const NEUTRALS: { dark: Record<DarkBackground, Ladder>; light: Record<LightBackground, Ladder> } = {
  dark: {
    black: { '--bg': [10, 2.5], '--bg-glow': [12, 6, '55'], '--ink': [22, 92.9], '--ink-2': [17, 76.5], '--ink-3': [12, 66.3], '--ink-4': [9, 49.8], '--neutral-track': [12, 66.3], '--surface-1': [8, 6], '--surface-2': [8, 8], '--surface-3': [8, 7], '--surface-4': [8, 9.5], '--surface-5': [8, 16], '--input-bg': [8, 4.5], '--backdrop': [20, 1, 'cc'], '--brand-surface': [10, 3] },
    deep: { '--bg': [16, 7.5], '--bg-glow': [16, 12.5, '55'], '--ink': [22, 92.9], '--ink-2': [17, 76.5], '--ink-3': [12, 66.3], '--ink-4': [9, 49.8], '--neutral-track': [12, 66.3], '--surface-1': [14, 11.4], '--surface-2': [15, 13.9], '--surface-3': [12, 12.5], '--surface-4': [16, 14.9], '--surface-5': [15, 21.8], '--input-bg': [20, 9.8], '--backdrop': [33, 3.5, 'bd'], '--brand-surface': [18, 7.6] },
    grey: { '--bg': [6, 15], '--bg-glow': [6, 21, '55'], '--ink': [8, 94], '--ink-2': [6, 79], '--ink-3': [5, 70], '--ink-4': [4, 57], '--neutral-track': [5, 70], '--surface-1': [6, 19], '--surface-2': [6, 22], '--surface-3': [6, 20.5], '--surface-4': [6, 24], '--surface-5': [6, 32], '--input-bg': [6, 17], '--backdrop': [10, 6, 'bd'], '--brand-surface': [6, 15] },
  },
  light: {
    white: { '--bg': [10, 99], '--bg-glow': [30, 92, '55'], '--ink': [15, 9.2], '--ink-2': [9, 24.9], '--ink-3': [6, 37.6], '--ink-4': [5, 49.6], '--neutral-track': [5, 49.6], '--surface-1': [0, 100], '--surface-2': [15, 98.5], '--surface-3': [10, 93.5], '--surface-4': [0, 100], '--surface-5': [0, 100], '--input-bg': [0, 100], '--backdrop': [13, 11.8, 'b0'], '--brand-surface': [10, 99] },
    paper: { '--bg': [26, 94.7], '--bg-glow': [43, 80.8, '55'], '--ink': [15, 9.2], '--ink-2': [9, 24.9], '--ink-3': [6, 37.6], '--ink-4': [5, 49.6], '--neutral-track': [5, 49.6], '--surface-1': [0, 100], '--surface-2': [41, 96.7], '--surface-3': [22, 90.4], '--surface-4': [0, 100], '--surface-5': [0, 100], '--input-bg': [0, 100], '--backdrop': [13, 11.8, 'b0'], '--brand-surface': [30, 95.5] },
    grey: { '--bg': [8, 88], '--bg-glow': [12, 80, '55'], '--ink': [12, 8], '--ink-2': [8, 22], '--ink-3': [6, 32], '--ink-4': [5, 42], '--neutral-track': [5, 42], '--surface-1': [6, 96], '--surface-2': [8, 93], '--surface-3': [8, 84], '--surface-4': [6, 96], '--surface-5': [6, 97], '--input-bg': [6, 97.5], '--backdrop': [10, 11.8, 'b0'], '--brand-surface': [8, 90] },
  },
};
/** The hue of the built-in green neutrals, used when a depth is chosen without an accent. */
const BUILT_IN_NEUTRAL_HUE: Record<Theme, number> = { dark: 115, light: 90 };

/** The neutrals for a theme: the hue of the chosen accent (or the built-in green's), the depth's saturation and lightness. */
export function neutralTokens(accentHex: string, depth: DarkBackground | LightBackground, theme: Theme): Record<NeutralToken, string> {
  const hue = isHex(accentHex) ? hexToHsl(accentHex)[0] : BUILT_IN_NEUTRAL_HUE[theme];
  const ladder = theme === 'dark' ? NEUTRALS.dark[depth as DarkBackground] ?? NEUTRALS.dark.deep : NEUTRALS.light[depth as LightBackground] ?? NEUTRALS.light.paper;
  return Object.fromEntries(NEUTRAL_TOKENS.map(token => { const [s, l, alpha = ''] = ladder[token]; return [token, `${hslToHex(hue, s, l)}${alpha}`]; })) as Record<NeutralToken, string>;
}

const isHex = (value: string) => /^#[0-9a-f]{6}$/i.test(value);

function applyTokens(tokens: readonly string[], values: Record<string, string> | undefined) {
  const style = document.documentElement.style;
  for (const token of tokens) { if (values) style.setProperty(token, values[token]); else style.removeProperty(token); }
}

/** Applies a chosen accent on top of the theme's stylesheet, or clears it so the built-in green returns. */
export function applyAccent(hex: string, theme: Theme) { applyTokens(ACCENT_TOKENS, isHex(hex) ? accentTokens(hex, theme) : undefined); }

/** Applies a chosen rest colour, or clears it so the built-in blue returns. */
export function applyRest(hex: string, theme: Theme) { applyTokens(REST_TOKENS, isHex(hex) ? restTokens(hex, theme) : undefined); }

/** Tints the neutrals with the accent's hue at the chosen depth, or clears them when both are the built-in defaults. */
export function applyNeutrals(accentHex: string, depth: DarkBackground | LightBackground, theme: Theme) {
  const builtIn = !isHex(accentHex) && depth === DEFAULT_BACKGROUND[theme];
  applyTokens(NEUTRAL_TOKENS, builtIn ? undefined : neutralTokens(accentHex, depth, theme));
}

/** The palette index.html applies before first paint, so a chosen background never flashes the built-in one. Mirrors the script there. */
export const PALETTE_KEY = 'openwod.palette';
function rememberPalette(theme: Theme) {
  const style = document.documentElement.style;
  const tokens = Object.fromEntries([...ACCENT_TOKENS, ...REST_TOKENS, ...NEUTRAL_TOKENS].map(token => [token, style.getPropertyValue(token)]).filter(([, value]) => value));
  try {
    const stored = JSON.parse(localStorage.getItem(PALETTE_KEY) ?? '{}') as Partial<Record<Theme, Record<string, string>>>;
    localStorage.setItem(PALETTE_KEY, JSON.stringify({ ...stored, [theme]: tokens }));
  } catch { /* Storage unavailable: the page still paints, only the first frame shows the built-in palette. */ }
}

const NO_CHOICE: Preferences['accent'] = { dark: '', light: '' };

/** Auto follows the operating system and reacts to live changes; an explicit choice overrides it. Each theme applies its own accent, rest colour and background depth. */
export function useTheme(preference: ThemePreference, accent: Preferences['accent'] = NO_CHOICE, rest: Preferences['restColor'] = NO_CHOICE, background: BackgroundChoice = DEFAULT_BACKGROUND) {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => {
      const theme = resolveTheme(preference, media.matches);
      applyTheme(theme); applyAccent(accent[theme], theme); applyRest(rest[theme], theme); applyNeutrals(accent[theme], background[theme], theme);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', document.documentElement.style.getPropertyValue('--bg') || THEME_COLOR[theme]);
      rememberPalette(theme);
    };
    update();
    if (preference !== 'auto') return;
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [preference, accent.dark, accent.light, rest.dark, rest.light, background.dark, background.light]);
}
