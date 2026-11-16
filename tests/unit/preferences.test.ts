import { afterEach, describe, expect, it } from 'vitest';
import { defaultPreferences, loadPreferences, normalisePreferences } from '../../apps/web/src/preferences';
import { BEEP_TONES } from '../../apps/web/src/audio';

const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); }, removeItem: (key: string) => { store.delete(key); } } });
afterEach(() => store.clear());

describe('preferences', () => {
  it('validates the household server\'s copy like this browser\'s and falls back on anything that is not an object', () => {
    expect(normalisePreferences({ theme: 'dark', names: { A: 'Sam' }, volume: 4 })).toMatchObject({ theme: 'dark', names: { A: 'Sam', B: defaultPreferences.names.B }, volume: 1 });
    expect(normalisePreferences(null)).toEqual(defaultPreferences);
    expect(normalisePreferences(['dark'])).toEqual(defaultPreferences);
  });
  it('accepts every offered beep tone, the truck horn included, and falls back on an unknown one', () => {
    for (const [tone] of BEEP_TONES) expect(normalisePreferences({ beepTone: tone }).beepTone).toBe(tone);
    expect(normalisePreferences({ beepTone: 'horn' }).beepTone).toBe('horn');
    expect(normalisePreferences({ beepTone: 'kazoo' }).beepTone).toBe(defaultPreferences.beepTone);
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
  it('keeps the milestone and paused colours per theme, lower-case, and drops anything that is not a colour', () => {
    const none = { dark: '', light: '' };
    expect(defaultPreferences.markColors).toEqual({ first: none, second: none });
    expect(defaultPreferences.pauseColor).toEqual(none);
    const kept = normalisePreferences({ markColors: { first: { dark: '#FF00FF', light: '#aa00aa' }, second: { light: '#00C2FF' } }, pauseColor: { dark: '#8844FF', light: 'grey' } });
    expect(kept.markColors).toEqual({ first: { dark: '#ff00ff', light: '#aa00aa' }, second: { dark: '', light: '#00c2ff' } });
    expect(kept.pauseColor).toEqual({ dark: '#8844ff', light: '' });
    for (const junk of ['grey', '#84f', '#8844ff80', 7, null, ['#8844ff'], { dark: 7, light: {} }]) {
      expect(normalisePreferences({ pauseColor: junk }).pauseColor).toEqual(none);
      expect(normalisePreferences({ markColors: { first: junk, second: junk } }).markColors).toEqual({ first: none, second: none });
    }
    expect(normalisePreferences({ markColors: 'red' }).markColors).toEqual({ first: none, second: none });
  });
  it('carries a single milestone or paused colour, the shape before each theme had its own, over to both themes', () => {
    store.set('openwod.preferences.v1', JSON.stringify({ markColors: { first: '#FF00FF', second: '' }, pauseColor: '#8844ff' }));
    expect(loadPreferences().markColors).toEqual({ first: { dark: '#ff00ff', light: '#ff00ff' }, second: { dark: '', light: '' } });
    expect(loadPreferences().pauseColor).toEqual({ dark: '#8844ff', light: '#8844ff' });
    // What is stored afterwards is the new shape, which reads back unchanged.
    expect(normalisePreferences(loadPreferences())).toEqual(loadPreferences());
  });
  it('keeps the skip length between 1 and 60 whole seconds', () => {
    store.set('openwod.preferences.v1', JSON.stringify({ nudgeSeconds: 2.6 }));
    expect(loadPreferences().nudgeSeconds).toBe(3);
    store.set('openwod.preferences.v1', JSON.stringify({ nudgeSeconds: 500 }));
    expect(loadPreferences().nudgeSeconds).toBe(60);
    store.set('openwod.preferences.v1', JSON.stringify({}));
    expect(loadPreferences().nudgeSeconds).toBe(defaultPreferences.nudgeSeconds);
  });
  it('keeps each part of the progress on its own, a part that is missing or not a boolean falling back alone', () => {
    expect(defaultPreferences.progress).toEqual({ bar: true, barPercent: true, clockPercent: false, donut: true });
    const all = { bar: false, barPercent: true, clockPercent: true, donut: false };
    expect(normalisePreferences({ progress: all }).progress).toEqual(all);
    expect(normalisePreferences({ progress: { bar: false, barPercent: 'yes', clockPercent: 1 } }).progress).toEqual({ bar: false, barPercent: true, clockPercent: false, donut: true });
    for (const junk of [undefined, null, 7, [], {}]) expect(normalisePreferences({ progress: junk }).progress).toEqual(defaultPreferences.progress);
    // The result is a copy: changing it never changes the defaults.
    normalisePreferences({}).progress.bar = false;
    expect(normalisePreferences({ progress: 'detail' }).progress.bar).toBe(true);
    expect(defaultPreferences.progress.bar).toBe(true);
  });
  it('turns the four looks the progress had before 1.6.0 into the parts the player showed for them', () => {
    const looks = {
      off: { bar: false, barPercent: false, clockPercent: false, donut: true },
      bar: { bar: true, barPercent: false, clockPercent: false, donut: true },
      detail: { bar: true, barPercent: true, clockPercent: false, donut: true },
      percent: { bar: true, barPercent: false, clockPercent: true, donut: true },
    };
    for (const [look, parts] of Object.entries(looks)) {
      // From this browser's storage and from another device through the household server alike.
      store.set('openwod.preferences.v1', JSON.stringify({ progress: look }));
      expect(loadPreferences().progress).toEqual(parts);
      expect(normalisePreferences({ progress: look }).progress).toEqual(parts);
    }
    expect(normalisePreferences({ progress: 'clock' }).progress).toEqual(defaultPreferences.progress);
    expect(normalisePreferences({ progress: 'constructor' }).progress).toEqual(defaultPreferences.progress);
  });
  it('drops the clock weight and size, which are no longer options', () => {
    const preferences = normalisePreferences({ clockWeight: 'light', clockSize: 'compact', theme: 'dark' });
    expect(preferences).not.toHaveProperty('clockWeight');
    expect(preferences).not.toHaveProperty('clockSize');
    expect(preferences.theme).toBe('dark');
  });
});
