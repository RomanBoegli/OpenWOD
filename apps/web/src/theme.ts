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

const ACCENT_TOKENS = ['--accent', '--accent-text', '--accent-fill', '--accent-fill-hover', '--accent-ink', '--accent-border', '--accent-soft', '--accent-track', '--focus', '--phase-work', '--brand-symbol'] as const;

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
    return { '--accent': accent, '--accent-text': accent, '--accent-fill': accent, '--accent-fill-hover': lighter, '--accent-ink': hslToHex(h, 25, 9), '--accent-border': lighter, '--accent-soft': `${accent}10`, '--accent-track': `${accent}1e`, '--focus': lighter, '--phase-work': accent, '--brand-symbol': accent };
  }
  const fill = hslToHex(h, s, 31), text = hslToHex(h, s, 27), accent = hslToHex(h, s, 34);
  return { '--accent': accent, '--accent-text': text, '--accent-fill': fill, '--accent-fill-hover': hslToHex(h, s, 37), '--accent-ink': '#ffffff', '--accent-border': fill, '--accent-soft': `${fill}14`, '--accent-track': `${fill}22`, '--focus': fill, '--phase-work': accent, '--brand-symbol': hslToHex(h, s, 40) };
}

/** Applies a chosen accent on top of the theme's stylesheet, or clears it so the built-in green returns. */
export function applyAccent(hex: string, theme: Theme) {
  const style = document.documentElement.style;
  if (!/^#[0-9a-f]{6}$/i.test(hex)) { for (const token of ACCENT_TOKENS) style.removeProperty(token); return; }
  for (const [token, value] of Object.entries(accentTokens(hex, theme))) style.setProperty(token, value);
}

const NO_ACCENT: Preferences['accent'] = { dark: '', light: '' };

/** Auto follows the operating system and reacts to live changes; an explicit choice overrides it. Each theme applies its own accent. */
export function useTheme(preference: ThemePreference, accent: Preferences['accent'] = NO_ACCENT) {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => { const theme = resolveTheme(preference, media.matches); applyTheme(theme); applyAccent(accent[theme], theme); };
    update();
    if (preference !== 'auto') return;
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [preference, accent.dark, accent.light]);
}
