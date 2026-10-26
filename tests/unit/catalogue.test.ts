import { describe, expect, it } from 'vitest';
import { Catalogue, MOVEMENT_ID_PATTERN, movementKey } from '../../packages/domain/src/catalogue';
import { seedMovements } from '../../packages/domain/src/movements';
import { bundledWorkouts } from '../../packages/domain/src/bundled';
import type { WorkoutNode } from '../../packages/domain/src/schema';

const catalogue = new Catalogue(seedMovements);

const ALLOWED_EQUIPMENT = ['Barbell', 'Rowing machine', 'Bike', 'SkiErg', 'Plyo box', 'Medicine ball', 'Slam ball', 'Jump rope', 'Pull-up bar', 'Rings', 'Kettlebell', 'Dumbbells', 'Bench', 'Sled', 'Sandbag', 'Climbing rope', 'Wall', 'AbMat', 'Weight plate', 'Parallettes'];

function fixtureNames(): string[] {
  const names = new Set<string>();
  const walk = (node: WorkoutNode) => {
    if (node.type === 'timed' || node.type === 'task') { for (const prescription of [node.assignments.A, node.assignments.B]) if (prescription) names.add(prescription.name); }
    else if (node.type === 'sequence') node.children.forEach(walk);
    else if (node.type === 'repeat') walk(node.body);
  };
  for (const workout of bundledWorkouts) for (const section of workout.sections) walk(section.body);
  return [...names].sort();
}

describe('seed movement catalogue', () => {
  it('has unique well-formed ids, unique names and no alias shadowing another record name', () => {
    const ids = seedMovements.map(record => record.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(MOVEMENT_ID_PATTERN);
    const nameKeys = seedMovements.map(record => movementKey(record.name));
    expect(new Set(nameKeys).size).toBe(nameKeys.length);
    const byNameKey = new Map(seedMovements.map(record => [movementKey(record.name), record.id]));
    for (const record of seedMovements) for (const alias of record.aliases ?? []) {
      const owner = byNameKey.get(movementKey(alias));
      expect(owner === undefined || owner === record.id, `alias "${alias}" of ${record.id} equals the name of ${owner}`).toBe(true);
    }
  });

  it('links every variant to a family head that is itself not a variant', () => {
    for (const record of seedMovements) {
      if (!record.family) continue;
      const head = catalogue.get(record.family);
      expect(head, `${record.id} points at unknown family ${record.family}`).toBeDefined();
      expect(head?.family, `${record.family} is both a head and a variant`).toBeUndefined();
    }
  });

  it('uses only the canonical equipment names', () => {
    for (const record of seedMovements) for (const item of record.equipment ?? []) expect(ALLOWED_EQUIPMENT, `${record.id} uses "${item}"`).toContain(item);
  });

  it('resolves every movement name used by the bundled workouts (the registry bundle enforces this too)', () => {
    const names = fixtureNames();
    expect(names.length).toBeGreaterThan(50);
    expect(names.filter(name => !catalogue.byName(name))).toEqual([]);
  });

  it('matches loosely on name and groups variants under their head', () => {
    expect(movementKey('Push presses')).toBe(movementKey('push press'));
    expect(movementKey('Toes-to-bar')).toBe(movementKey('toes to bar'));
    expect(movementKey('Thruster')).toBe(movementKey('Thrusters'));
    expect(catalogue.byName('C2B')?.id).toBe('chest-to-bar-pull-up');
    expect(catalogue.byName('Wall-ball shots')?.id).toBe('wall-ball');
    const cleans = catalogue.grouped().find(group => group.head.id === 'clean');
    expect(cleans?.variants.length).toBeGreaterThanOrEqual(4);
    expect(cleans?.variants.map(record => record.id)).toContain('hang-power-clean');
    expect(seedMovements.length).toBeGreaterThanOrEqual(170);
    expect(seedMovements.length).toBeLessThanOrEqual(200);
  });
});
