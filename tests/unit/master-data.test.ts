import { describe, expect, it } from 'vitest';
import { compileSchema } from '../../packages/domain/src/validate';
import { emptyMasterData, isEmptyMasterData, MasterDataSchema, mergeMasterData, sanitiseMasterData, type MasterData } from '../../packages/domain/src/master-data';

const validate = compileSchema<MasterData>(MasterDataSchema);

describe('master data document', () => {
  it('keeps the removed bundled workouts, and reads a document from before they existed', () => {
    const data = sanitiseMasterData({ ...emptyMasterData(), hiddenWorkouts: ['fran', '', 3] });
    expect(data.hiddenWorkouts).toEqual(['fran']);
    expect(isEmptyMasterData(data)).toBe(false);
    const { hiddenWorkouts: _dropped, ...older } = emptyMasterData();
    expect(validate(older)).toBe(true);
    expect(sanitiseMasterData(older).hiddenWorkouts).toEqual([]);
    expect(mergeMasterData({ ...emptyMasterData(), hiddenWorkouts: ['fran'] }, { ...emptyMasterData(), hiddenWorkouts: ['cindy', 'fran'] }).hiddenWorkouts).toEqual(['fran', 'cindy']);
  });

  it('sanitises a stored document, dropping what is out of bounds, and the result validates', () => {
    const data = sanitiseMasterData({
      equipmentAliases: { 'kettle bells': 'Kettlebell', '': 'nothing', bad: 42 },
      collections: [{ id: 'mine', title: 'Mine', workoutIds: ['fran', 7] }, { id: 'benchmarks', title: 'Benchmarks renamed', workoutIds: ['fran'] }, 'junk'],
      movements: [{ id: 'pogo-hop', name: 'Pogo hops', category: 'nonsense' }, { id: 'Bad Id', name: 'x' }],
      hiddenMovements: ['thruster', ''],
      movementAliases: { 'Wall-Ball Shots': 'wall-ball' },
      committed: ['equipment:kettle bell'],
    });
    expect(data.equipmentAliases).toEqual({ 'kettle bell': 'Kettlebell' });
    expect(data.collections).toEqual([{ id: 'mine', title: 'Mine', workoutIds: ['fran'] }]);
    expect(data.collectionEdits.benchmarks?.title).toBe('Benchmarks renamed');
    expect(data.movements).toEqual([{ id: 'pogo-hop', name: 'Pogo hops' }]);
    expect(data.hiddenMovements).toEqual(['thruster']);
    expect(validate(data)).toBe(true);
    expect(validate({ ...data, extra: true })).toBe(false);
    expect(sanitiseMasterData('garbage')).toEqual(emptyMasterData());
    expect(isEmptyMasterData(emptyMasterData())).toBe(true);
    expect(isEmptyMasterData(data)).toBe(false);
  });

  it('merges two documents with the base winning on collisions, and merging is idempotent', () => {
    const base: MasterData = { ...emptyMasterData(), equipmentAliases: { kb: 'Kettlebell' }, collections: [{ id: 'a', title: 'A', workoutIds: ['fran'] }], movements: [{ id: 'pogo-hop', name: 'Pogo hops' }], hiddenMovements: ['x'], committed: ['one'] };
    const incoming: MasterData = { ...emptyMasterData(), equipmentAliases: { kb: 'KB', db: 'Dumbbell' }, collections: [{ id: 'a', title: 'Other A', workoutIds: [] }, { id: 'b', title: 'B', workoutIds: ['cindy'] }], movements: [{ id: 'pogo-hop', name: 'Pogo jumps' }, { id: 'new-one', name: 'New one' }], hiddenMovements: ['y'], committed: ['two'] };
    const merged = mergeMasterData(base, incoming);
    expect(merged.equipmentAliases).toEqual({ kb: 'Kettlebell', db: 'Dumbbell' });
    expect(merged.collections.map(item => item.title)).toEqual(['A', 'B']);
    expect(merged.movements.map(item => item.name)).toEqual(['Pogo hops', 'New one']);
    expect(merged.hiddenMovements).toEqual(['x', 'y']);
    expect(merged.committed).toEqual(['one', 'two']);
    expect(mergeMasterData(merged, incoming)).toEqual(merged);
  });
});
