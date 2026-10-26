import { afterEach, describe, expect, it } from 'vitest';
import { defaultPreferences, loadPreferences } from '../../apps/web/src/preferences';

const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); }, removeItem: (key: string) => { store.delete(key); } } });
afterEach(() => store.clear());

describe('preferences', () => {
  it('carries a pre-1.1 single accent over to both themes', () => {
    store.set('openwod.preferences.v1', JSON.stringify({ accent: '#ec4899' }));
    expect(loadPreferences().accent).toEqual({ dark: '#ec4899', light: '#ec4899' });
  });
  it('keeps one accent per theme and drops anything that is not a colour', () => {
    store.set('openwod.preferences.v1', JSON.stringify({ accent: { dark: '#3b82f6', light: 'red' } }));
    expect(loadPreferences().accent).toEqual({ dark: '#3b82f6', light: '' });
    expect(loadPreferences().theme).toBe(defaultPreferences.theme);
  });
});
