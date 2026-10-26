import { describe, expect, it } from 'vitest';
import { allCollections, collectionOf, emptyMasterData, upsertCollection } from '../../apps/web/src/master-data';

describe('collections on a device', () => {
  it('keeps a workout in one of your collections at a time and shows yours before the bundled one', () => {
    let data = upsertCollection(emptyMasterData(), { id: 'tuesday', title: 'Tuesday', workoutIds: ['fran', 'cindy'] });
    data = upsertCollection(data, { id: 'short', title: 'Short', workoutIds: ['fran'] });
    expect(data.collections.find(item => item.id === 'tuesday')?.workoutIds).toEqual(['cindy']);
    expect(data.collections.find(item => item.id === 'short')?.workoutIds).toEqual(['fran']);
    data = upsertCollection(data, { id: 'tuesday', title: 'Tuesday favourites', workoutIds: ['cindy', 'fran'] });
    expect(data.collections.map(item => item.id)).toEqual(['tuesday', 'short']); // edited in place
    expect(data.collectionEdits.benchmarks.removed).toEqual(expect.arrayContaining(['fran', 'cindy']));
    expect(data.collections.find(item => item.id === 'short')?.workoutIds).toEqual([]);
    const all = allCollections(data);
    expect(collectionOf(all, 'fran')?.id).toBe('tuesday');
    expect(collectionOf(all, 'karen')?.id).toBe('benchmarks');
    expect(collectionOf(all, 'partner-circuit')?.id).toBe('default');
    expect(all.some(collection => collection.id === 'partners')).toBe(false);
    // Editing a bundled collection stores an override; a workout moved into your own collection leaves the bundled one.
    data = upsertCollection(data, { ...all.find(collection => collection.id === 'hyrox')!, description: 'Race prep', workoutIds: [...all.find(collection => collection.id === 'hyrox')!.workoutIds, 'tabata-this'] });
    const hyrox = allCollections(data).find(collection => collection.id === 'hyrox')!;
    expect(hyrox).toMatchObject({ description: 'Race prep', builtIn: true });
    expect(hyrox.workoutIds).toContain('tabata-this');
    expect(data.collectionEdits.hyrox).toEqual({ description: 'Race prep', added: ['tabata-this'], removed: [] }); // a delta, so a workout added to the folder later still shows
    expect(allCollections(data).find(collection => collection.id === 'default')?.workoutIds).not.toContain('tabata-this');
    data = upsertCollection(data, { id: 'short', title: 'Short', workoutIds: ['fran', 'karen'] });
    expect(allCollections(data).find(collection => collection.id === 'benchmarks')?.workoutIds).not.toContain('karen');
    expect(allCollections(data).map(collection => collection.id).slice(0, 4)).toEqual(['advanced', 'benchmarks', 'default', 'hyrox']);
  });
});
