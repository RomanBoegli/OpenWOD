import { describe, expect, it } from 'vitest';
import { Catalogue } from '../../packages/domain/src/catalogue';
import { seedMovements } from '../../packages/domain/src/movements';
import { summariseWorkout } from '../../packages/domain/src/library';
import { bundledWorkout } from '../../packages/domain/src/bundled';
import { effectiveCatalogue, emptyMasterData, mergeMovements, removeMovement, upsertMovement } from '../../apps/web/src/master-data';
import { linkWorkout, recordForName, unmatchedMovements } from '../../apps/web/src/catalogue-link';
import { workoutToBuilder } from '../../packages/domain/src/builder';
const fran = bundledWorkout('fran');

describe('movement catalogue on a device', () => {
  it('bundled records resolve by name, id and alias; a prescription id wins over its name', () => {
    const catalogue = effectiveCatalogue(emptyMasterData());
    expect(catalogue.byName('Thruster')?.id).toBe('thruster');
    expect(catalogue.byName('wall-ball shots')?.id).toBe('wall-ball');
    expect(catalogue.resolve({ movement: 'pull-up', name: 'Anything' })?.id).toBe('pull-up');
    expect(catalogue.head(catalogue.get('hang-power-clean')!).id).toBe('clean');
  });

  it('links a workout to records without touching its names, and lists what it cannot link', () => {
    const catalogue = effectiveCatalogue(emptyMasterData());
    const linked = linkWorkout(fran, catalogue);
    const first = linked.sections[0].body;
    expect(first.type).toBe('sequence');
    if (first.type !== 'sequence') return;
    const thrusters = first.children[0];
    expect(thrusters.type === 'task' && thrusters.assignments.A).toMatchObject({ movement: 'thruster', name: 'Thrusters' });
    const draft = workoutToBuilder({ ...fran, sections: fran.sections.map(section => ({ ...section, body: { ...section.body, ...(section.body.type === 'sequence' ? { children: section.body.children.map((child, index) => index === 0 && child.type === 'task' ? { ...child, assignments: { A: { ...child.assignments.A, name: 'Pogo hops' } } } : child) } : {}) } })) })!;
    expect(unmatchedMovements(draft, catalogue)).toEqual(['Pogo hops']);
    expect(recordForName('Pogo hops', catalogue)).toEqual({ id: 'pogo-hop', name: 'Pogo hops' });
    expect(recordForName('Kettlebell halos', catalogue)).toMatchObject({ id: 'kettlebell-halo', equipment: ['Kettlebell'] });
  });

  it('summaries take equipment from the records of recognised movements', () => {
    const summary = summariseWorkout(fran, { catalogue: new Catalogue(seedMovements) });
    expect(summary.equipmentNeeded).toEqual(expect.arrayContaining(['Barbell', 'Pull-up bar']));
  });

  it('renaming keeps the old name as an alias; removing a head promotes its variants; merging redirects names', () => {
    let data = upsertMovement(emptyMasterData(), { ...effectiveCatalogue(emptyMasterData()).get('wall-ball')!, name: 'Wallballs' });
    let catalogue = effectiveCatalogue(data);
    expect(catalogue.get('wall-ball')?.name).toBe('Wallballs');
    expect(catalogue.byName('Wall balls')?.id).toBe('wall-ball');
    data = removeMovement(data, 'clean');
    catalogue = effectiveCatalogue(data);
    expect(catalogue.get('clean')).toBeUndefined();
    expect(catalogue.get('hang-power-clean')?.family).toBeUndefined();
    data = upsertMovement(data, { id: 'wb-shot', name: 'WB shots' });
    data = mergeMovements(data, ['wb-shot', 'wall-ball'], 'wall-ball');
    catalogue = effectiveCatalogue(data);
    expect(catalogue.get('wb-shot')).toBeUndefined();
    expect(catalogue.byName('WB shots')?.id).toBe('wall-ball');
  });
});
