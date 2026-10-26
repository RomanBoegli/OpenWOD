import { useEffect } from 'react';
import type { ThemePreference } from './preferences';

export type Theme = 'light' | 'dark';
const THEME_COLOR: Record<Theme, string> = { dark: '#101613', light: '#f3f5ee' };

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): Theme {
  return preference === 'auto' ? (prefersDark ? 'dark' : 'light') : preference;
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
}

/** Auto follows the operating system and reacts to live changes; an explicit choice overrides it. */
export function useTheme(preference: ThemePreference) {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => applyTheme(resolveTheme(preference, media.matches));
    update();
    if (preference !== 'auto') return;
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [preference]);
}
