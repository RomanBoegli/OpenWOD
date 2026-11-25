import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadStageZoom, saveStageZoom, STAGE_ZOOMS, stepStageZoom } from '../../apps/web/src/stage-zoom';

describe('the stations’ zoom (UI-33)', () => {
  afterEach(() => vi.unstubAllGlobals());
  const storage = (initial: Record<string, string> = {}) => {
    const values = new Map(Object.entries(initial));
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } });
    return values;
  };

  it('has 100 % among its steps and walks them one at a time, stopping at either end', () => {
    expect(STAGE_ZOOMS).toContain(1);
    expect([...STAGE_ZOOMS]).toEqual([...STAGE_ZOOMS].sort((a, b) => a - b));
    expect(stepStageZoom(1, 1)).toBe(1.15);
    expect(stepStageZoom(1, -1)).toBe(.85);
    expect(stepStageZoom(STAGE_ZOOMS[0], -1)).toBe(STAGE_ZOOMS[0]);
    expect(stepStageZoom(1.5, 1)).toBe(1.5);
  });

  it('is kept in this browser under its own key, apart from the household’s settings', () => {
    const values = storage();
    expect(loadStageZoom()).toBe(1);
    saveStageZoom(1.3);
    expect(values.get('openwod.stage-zoom.v1')).toBe('1.3');
    expect(loadStageZoom()).toBe(1.3);
    expect([...values.keys()]).toEqual(['openwod.stage-zoom.v1']);
  });

  it('reads anything but one of its steps as 100 %, and works without storage', () => {
    for (const stored of ['2', '0', 'big', '1.2', '']) { storage({ 'openwod.stage-zoom.v1': stored }); expect(loadStageZoom(), stored).toBe(1); }
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(loadStageZoom()).toBe(1);
    expect(() => saveStageZoom(1.15)).not.toThrow();
  });
});
