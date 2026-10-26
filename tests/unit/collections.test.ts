import { describe, expect, it } from 'vitest';
import { allCollections, collectionOf, emptyMasterData, upsertCollection } from '../../apps/web/src/master-data';

describe('collections on a device', () => {
  it('keeps a workout in one of your collections at a time and shows yours before the bundled one', () => {
    let data = upsertCollection(emptyMasterData(), { id: 'tuesday', title: 'Tuesday', workoutIds: ['fran', 'cindy'] });
    data = upsertCollection(data, { id: 'short', title: 'Short', workoutIds: ['fran'] });
    expect(data.collections.find(item => item.id === 'tuesday')?.workoutIds).toEqual(['cindy']);
    expect(data.collections.find(item => item.id === 'short')?.workoutIds).toEqual(['fran']);
    data = upsertCollection(data, { id: 'tuesday', title: 'Tuesday favourites', workoutIds: ['cindy', 'fran'] });
    expect(data.collections.map(item => item.id)).toEqual(['benchmarks', 'tuesday', 'short']); // edited in place; Benchmarks got an override without Fran and Cindy
    expect(data.collections.find(item => item.id === 'benchmarks')?.workoutIds).not.toContain('fran');
    expect(data.collections.find(item => item.id === 'short')?.workoutIds).toEqual([]);
    const all = allCollections(data);
    expect(collectionOf(all, 'fran')?.id).toBe('tuesday');
    expect(collectionOf(all, 'karen')?.id).toBe('benchmarks');
    expect(collectionOf(all, 'partner-circuit')?.id).toBe('default');
    expect(all.some(collection => collection.id === 'partners')).toBe(false);
    // Editing a bundled collection stores an override; a workout moved into your own collection leaves the bundled one.
    data = upsertCollection(data, { ...all.find(collection => collection.id === 'hyrox')!, description: 'Race prep' });
    expect(allCollections(data).find(collection => collection.id === 'hyrox')).toMatchObject({ description: 'Race prep', builtIn: true });
    data = upsertCollection(data, { id: 'short', title: 'Short', workoutIds: ['fran', 'karen'] });
    expect(allCollections(data).find(collection => collection.id === 'benchmarks')?.workoutIds).not.toContain('karen');
    expect(allCollections(data).map(collection => collection.id).slice(0, 4)).toEqual(['benchmarks', 'coach-programming', 'default', 'hyrox']);
  });
});
