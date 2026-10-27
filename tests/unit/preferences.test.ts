import { afterEach, describe, expect, it } from 'vitest';
import { defaultPreferences, loadPreferences, normalisePreferences } from '../../apps/web/src/preferences';

const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); }, removeItem: (key: string) => { store.delete(key); } } });
afterEach(() => store.clear());

describe('preferences', () => {
  it('validates the household server\'s copy like this browser\'s and falls back on anything that is not an object', () => {
    expect(normalisePreferences({ theme: 'dark', names: { A: 'Sam' }, volume: 4 })).toMatchObject({ theme: 'dark', names: { A: 'Sam', B: defaultPreferences.names.B }, volume: 1 });
    expect(normalisePreferences(null)).toEqual(defaultPreferences);
    expect(normalisePreferences(['dark'])).toEqual(defaultPreferences);
  });
  it('carries a pre-1.1 single accent over to both themes', () => {
    store.set('openwod.preferences.v1', JSON.stringify({ accent: '#ec4899' }));
    expect(loadPreferences().accent).toEqual({ dark: '#ec4899', light: '#ec4899' });
  });
  it('keeps one accent per theme and drops anything that is not a colour', () => {
    store.set('openwod.preferences.v1', JSON.stringify({ accent: { dark: '#3b82f6', light: 'red' } }));
    expect(loadPreferences().accent).toEqual({ dark: '#3b82f6', light: '' });
    expect(loadPreferences().theme).toBe(defaultPreferences.theme);
  });
  it('keeps one rest colour per theme and falls back to the built-in blue', () => {
    store.set('openwod.preferences.v1', JSON.stringify({ restColor: { dark: '#EC4899', light: 7 } }));
    expect(loadPreferences().restColor).toEqual({ dark: '#ec4899', light: '' });
    store.set('openwod.preferences.v1', JSON.stringify({ background: { dark: 'black', light: 'neon' } }));
    expect(loadPreferences().background).toEqual({ dark: 'black', light: 'paper' });
    store.set('openwod.preferences.v1', JSON.stringify({}));
    expect(loadPreferences().restColor).toEqual(defaultPreferences.restColor);
  });
  it('keeps the skip length between 1 and 60 whole seconds and knows the progress option with the percentage', () => {
    store.set('openwod.preferences.v1', JSON.stringify({ nudgeSeconds: 2.6, progress: 'percent' }));
    expect(loadPreferences().nudgeSeconds).toBe(3);
    expect(loadPreferences().progress).toBe('percent');
    store.set('openwod.preferences.v1', JSON.stringify({ nudgeSeconds: 500, progress: 'clock' }));
    expect(loadPreferences().nudgeSeconds).toBe(60);
    expect(loadPreferences().progress).toBe('detail');
    store.set('openwod.preferences.v1', JSON.stringify({}));
    expect(loadPreferences().nudgeSeconds).toBe(defaultPreferences.nudgeSeconds);
  });
});
