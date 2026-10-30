import { describe, expect, it } from 'vitest';
import { Catalogue, MOVEMENT_ID_PATTERN, movementKey } from '../../packages/domain/src/catalogue';
import { seedMovements } from '../../packages/domain/src/movements';
import { bundledWorkouts } from '../../packages/domain/src/bundled';
import type { WorkoutNode } from '../../packages/domain/src/schema';

const catalogue = new Catalogue(seedMovements);

const ALLOWED_EQUIPMENT = ['Barbell', 'Rowing machine', 'Bike', 'SkiErg', 'Plyo box', 'Medicine ball', 'Slam ball', 'Jump rope', 'Pull-up bar', 'Rings', 'Kettlebell', 'Dumbbells', 'Bench', 'Sled', 'Sandbag', 'Climbing rope', 'Wall', 'AbMat', 'Weight plate', 'Parallettes', 'GHD', 'Battle rope', 'Tyre', 'Yoke'];

// Title Case: every word capitalised except short articles, conjunctions and prepositions inside a name, inside hyphenated
// compounds too ("Toes-to-Bar"). Acronyms and brands (DB, AbMat) pass as written, numbers and units after them or in brackets ("(cal)") too.
const MINOR = new Set(['a', 'an', 'the', 'and', 'or', 'nor', 'but', 'to', 'of', 'on', 'in', 'at', 'by', 'per', 'vs', 'via', 'as', 'for']);
function isTitleCase(text: string): boolean {
  const words = text.split(' ');
  return words.every((word, index) => word.split('-').every((part, i) => {
    const bare = part.replace(/^[^A-Za-z0-9]+/, '').replace(/[^A-Za-z0-9]+$/, '');
    const inside = !(index === 0 && i === 0) && !(index === words.length - 1 && i === word.split('-').length - 1);
    return !bare || /^[A-Z0-9]/.test(bare) || (inside && MINOR.has(bare)) || part.startsWith('(') || (i === 0 && /\d$/.test(words[index - 1] ?? ''));
  }));
}

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

  it('keeps aliases useful: none repeats a name of its record, none belongs to two records, and every short name resolves', () => {
    const owners = new Map<string, string>();
    for (const record of seedMovements) {
      const keys = [movementKey(record.name)];
      for (const alias of record.aliases ?? []) {
        const key = movementKey(alias);
        expect(keys, `alias "${alias}" of ${record.id} only repeats another of its names`).not.toContain(key);
        keys.push(key);
        const owner = owners.get(key);
        expect(owner === undefined || owner === record.id, `alias "${alias}" belongs to ${owner} and ${record.id}`).toBe(true);
        owners.set(key, record.id);
      }
      if (record.shortName) expect(catalogue.byName(record.shortName)?.id, `short name "${record.shortName}" of ${record.id}`).toBe(record.id);
    }
  });

  it('writes movement names and workout titles in Title Case', () => {
    const offending = (text: string) => !isTitleCase(text);
    const names = seedMovements.flatMap(record => [record.name, record.shortName ?? '', ...(record.aliases ?? [])]).filter(Boolean);
    expect(names.filter(offending)).toEqual([]);
    expect(fixtureNames().filter(offending)).toEqual([]);
    expect(bundledWorkouts.map(workout => workout.title).filter(offending)).toEqual([]);
  });

  it('lists in every bundled workout the equipment its movements need', () => {
    for (const workout of bundledWorkouts) {
      const needed = new Set<string>();
      const walk = (node: WorkoutNode) => {
        if (node.type === 'timed' || node.type === 'task') { for (const prescription of [node.assignments.A, node.assignments.B]) if (prescription) for (const item of catalogue.byName(prescription.name)?.equipment ?? []) needed.add(item); }
        else if (node.type === 'sequence') node.children.forEach(walk);
        else if (node.type === 'repeat') walk(node.body);
      };
      for (const section of workout.sections) walk(section.body);
      expect([...needed].filter(item => !workout.equipment.includes(item)), workout.id).toEqual([]);
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
    expect(movementKey('Push Presses')).toBe(movementKey('push press'));
    expect(movementKey('Toes-to-Bar')).toBe(movementKey('toes to bar'));
    expect(movementKey('Thruster')).toBe(movementKey('Thrusters'));
    expect(catalogue.byName('C2B')?.id).toBe('chest-to-bar-pull-up');
    expect(catalogue.byName('Wall-Ball Shots')?.id).toBe('wall-ball');
    const cleans = catalogue.grouped().find(group => group.head.id === 'clean');
    expect(cleans?.variants.length).toBeGreaterThanOrEqual(4);
    expect(cleans?.variants.map(record => record.id)).toContain('hang-power-clean');
    expect(seedMovements.length).toBeGreaterThanOrEqual(170);
    expect(seedMovements.length).toBeLessThanOrEqual(300);
  });
});
