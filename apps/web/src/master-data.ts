import { Catalogue, movementKey, movementSlug, type Movement, type MovementLoads } from '../../../packages/domain/src/catalogue';
import { equipmentKey } from '../../../packages/domain/src/library';
import { seedMovements } from '../../../packages/domain/src/movements';
import type { LoadLevel, LoadValue, Prescription } from '../../../packages/domain/src/schema';
import { benchmarkWorkouts, coachWorkouts, fixtureWorkouts } from '../../../packages/domain/src/fixtures';

/**
 * Master data kept on this device until the server milestone: equipment spellings (merges), collections of workouts,
 * and the exercise catalogue (your own records, overrides of bundled ones, merges and removals). Everything here is
 * presentation and organisation; it never changes a workout file.
 */
export interface Collection { id: string; title: string; description?: string; workoutIds: string[]; builtIn?: boolean }
export type Sex = 'men' | 'women';
export type { Movement, MovementLoads };
export interface MasterData {
  /** Equipment key (see equipmentKey) → canonical display name. */
  equipmentAliases: Record<string, string>;
  collections: Collection[];
  /** Your exercise records: new ones, and overrides of bundled records with the same id. */
  movements: Movement[];
  /** Bundled record ids you removed. */
  hiddenMovements: string[];
  /** Extra spellings → record id, from merges and renames ("Wall-ball shots" → wall-ball). */
  movementAliases: Record<string, string>;
}

const KEY = 'openwod.master.v1';

/** Collections that ship with the app. They are not editable; your own collections sit beside them. */
export const builtInCollections: Collection[] = [
  { id: 'benchmarks', title: 'Benchmarks', description: 'The classic CrossFit girls and hero workouts, as published.', workoutIds: ['fran', 'cindy', ...benchmarkWorkouts.map(workout => workout.id)], builtIn: true },
  { id: 'coach-programming', title: 'Coach programming', description: 'Standalone pieces curated from class programming.', workoutIds: coachWorkouts.map(workout => workout.id), builtIn: true },
  { id: 'hyrox', title: 'HYROX', description: 'Training variations of the race structure.', workoutIds: fixtureWorkouts.filter(workout => workout.id.startsWith('hyrox-') || workout.id === 'run-sled-run').map(workout => workout.id), builtIn: true },
  { id: 'partners', title: 'Partner sessions', description: 'Everything built for two.', workoutIds: fixtureWorkouts.filter(workout => workout.participants === 2).map(workout => workout.id), builtIn: true },
];

export const allCollections = (data: MasterData): Collection[] => [...builtInCollections, ...data.collections];
export const emptyMasterData = (): MasterData => ({ equipmentAliases: {}, collections: [], movements: [], hiddenMovements: [], movementAliases: {} });

const text = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const level = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(10_000, value) : 0;
const strings = (value: unknown, max: number, each = 80) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, max).map(item => item.trim().slice(0, each)) : [];
const MOVEMENT_LIMIT = 600;

function readLoads(value: unknown): MovementLoads | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const loads = value as Partial<MovementLoads>;
  const read = (group: unknown): Record<LoadLevel, number> => { const item = (group ?? {}) as Partial<Record<LoadLevel, unknown>>; return { light: level(item.light), medium: level(item.medium), heavy: level(item.heavy) }; };
  const result = { unit: loads.unit === 'lb' ? 'lb' as const : 'kg' as const, men: read(loads.men), women: read(loads.women) };
  return Object.values(result.men).some(Boolean) || Object.values(result.women).some(Boolean) ? result : undefined;
}

function readMovement(value: unknown): Movement | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as Partial<Movement>;
  const id = text(item.id, 80);
  const name = text(item.name, 160);
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id) || !name) return undefined;
  const record: Movement = { id, name };
  if (text(item.shortName, 60)) record.shortName = text(item.shortName, 60);
  if (text(item.spokenName, 160)) record.spokenName = text(item.spokenName, 160);
  const aliases = strings(item.aliases, 20, 160);
  if (aliases.length) record.aliases = aliases;
  if (text(item.family, 80)) record.family = text(item.family, 80);
  const equipment = strings(item.equipment, 10);
  if (equipment.length) record.equipment = equipment;
  if (typeof item.category === 'string' && ['weightlifting', 'gymnastics', 'monostructural', 'strength', 'conditioning', 'mobility'].includes(item.category)) record.category = item.category;
  const loads = readLoads(item.loads);
  if (loads) record.loads = loads;
  if (text(item.notes, 500)) record.notes = text(item.notes, 500);
  return record;
}

export function loadMasterData(): MasterData {
  try {
    const raw = localStorage.getItem(KEY);
    const stored = raw ? JSON.parse(raw) as Partial<MasterData> & { movementLoads?: unknown } : {};
    const aliases: Record<string, string> = {};
    if (stored.equipmentAliases && typeof stored.equipmentAliases === 'object') for (const [key, name] of Object.entries(stored.equipmentAliases)) if (text(key, 80) && text(name, 80)) aliases[equipmentKey(key)] = text(name, 80);
    const collections: Collection[] = Array.isArray(stored.collections) ? stored.collections.filter((item): item is Collection => Boolean(item && typeof item === 'object' && typeof item.id === 'string' && typeof item.title === 'string' && Array.isArray(item.workoutIds))).slice(0, 50).map(item => ({ id: text(item.id, 120), title: text(item.title, 120) || 'Collection', ...(item.description ? { description: text(item.description, 500) } : {}), workoutIds: item.workoutIds.filter((id): id is string => typeof id === 'string').slice(0, 500) })) : [];
    const movements = (Array.isArray(stored.movements) ? stored.movements : []).map(readMovement).filter((item): item is Movement => Boolean(item)).slice(0, MOVEMENT_LIMIT);
    const hiddenMovements = strings(stored.hiddenMovements, MOVEMENT_LIMIT);
    const movementAliases: Record<string, string> = {};
    if (stored.movementAliases && typeof stored.movementAliases === 'object') for (const [key, id] of Object.entries(stored.movementAliases)) if (text(key, 160) && text(id, 80)) movementAliases[text(key, 160)] = text(id, 80);
    let data: MasterData = { equipmentAliases: aliases, collections, movements, hiddenMovements, movementAliases };
    // Earlier versions kept a separate movement-loads table; it becomes loads on the matching catalogue records.
    if (Array.isArray(stored.movementLoads)) {
      for (const legacy of stored.movementLoads as { name?: unknown }[]) {
        const name = text(legacy?.name, 160);
        const loads = readLoads(legacy);
        if (!name || !loads) continue;
        const catalogue = effectiveCatalogue(data);
        const existing = catalogue.byName(name);
        data = upsertMovement(data, existing ? { ...existing, loads } : { id: freeMovementId(movementSlug(name), catalogue), name, loads });
      }
    }
    return data;
  } catch { return emptyMasterData(); }
}

export function persistMasterData(data: MasterData): string | undefined {
  try { localStorage.setItem(KEY, JSON.stringify(data)); return undefined; } catch { return 'This device could not save your settings. They last for this visit only.'; }
}

// ---- Equipment -----------------------------------------------------------------------------------------------

/** The canonical spelling for an equipment name after merges. */
export const canonicalEquipment = (aliases: Record<string, string>) => (name: string): string => aliases[equipmentKey(name)] ?? name;

/** Merge every spelling in `names` into `target`: all of them, including the target's own key, map to the target. */
export function mergeEquipment(data: MasterData, names: string[], target: string): MasterData {
  const aliases = { ...data.equipmentAliases };
  const canonical = target.trim();
  if (!canonical) return data;
  for (const name of names) if (name.trim()) aliases[equipmentKey(name)] = canonical;
  // Anything that pointed at one of the merged names now points at the target too.
  for (const [key, value] of Object.entries(aliases)) if (names.some(name => equipmentKey(name) === equipmentKey(value))) aliases[key] = canonical;
  return { ...data, equipmentAliases: aliases };
}

export function unmergeEquipment(data: MasterData, key: string): MasterData {
  const aliases = { ...data.equipmentAliases };
  delete aliases[key];
  return { ...data, equipmentAliases: aliases };
}

// ---- Exercise catalogue ---------------------------------------------------------------------------------------

export const seedIds = new Set(seedMovements.map(record => record.id));

/** The catalogue as this device sees it: bundled records minus removals, with overrides, your own records and merge aliases applied. */
export function effectiveCatalogue(data: MasterData): Catalogue {
  const overrides = new Map(data.movements.map(record => [record.id, record]));
  const hidden = new Set(data.hiddenMovements);
  const records: Movement[] = [];
  for (const seed of seedMovements) if (!hidden.has(seed.id)) records.push(overrides.get(seed.id) ?? seed);
  for (const own of data.movements) if (!seedIds.has(own.id)) records.push(own);
  const extra = new Map<string, string[]>();
  for (const [spelling, id] of Object.entries(data.movementAliases)) extra.set(id, [...(extra.get(id) ?? []), spelling]);
  return new Catalogue(records.map(record => extra.has(record.id) ? { ...record, aliases: [...(record.aliases ?? []), ...extra.get(record.id)!] } : record));
}

export function freeMovementId(wanted: string, catalogue: Catalogue): string {
  const base = wanted.replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '') || 'movement';
  if (!catalogue.get(base) && !seedIds.has(base)) return base;
  for (let counter = 2; ; counter++) { const candidate = `${base}-${counter}`.slice(0, 80); if (!catalogue.get(candidate) && !seedIds.has(candidate)) return candidate; }
}

/** Create or replace a record. Renaming keeps the old name as an alias so saved workouts still resolve. */
export function upsertMovement(data: MasterData, record: Movement): MasterData {
  const previous = effectiveCatalogue(data).get(record.id);
  const clean: Movement = { ...record, name: record.name.trim() };
  if (previous && movementKey(previous.name) !== movementKey(clean.name)) {
    const aliases = clean.aliases ?? [];
    if (!aliases.some(alias => movementKey(alias) === movementKey(previous.name))) clean.aliases = [...aliases, previous.name];
  }
  if (clean.family === clean.id) delete clean.family;
  const movements = [...data.movements.filter(item => item.id !== clean.id), clean];
  return { ...data, movements, hiddenMovements: data.hiddenMovements.filter(id => id !== clean.id) };
}

/** Remove a record; its variants move up to its parent (or become heads) and its aliases are dropped. */
export function removeMovement(data: MasterData, id: string): MasterData {
  const catalogue = effectiveCatalogue(data);
  const removed = catalogue.get(id);
  if (!removed) return data;
  let next: MasterData = {
    ...data,
    movements: data.movements.filter(item => item.id !== id),
    hiddenMovements: seedIds.has(id) ? [...new Set([...data.hiddenMovements, id])] : data.hiddenMovements,
    movementAliases: Object.fromEntries(Object.entries(data.movementAliases).filter(([, target]) => target !== id)),
  };
  for (const variant of catalogue.variants(id)) { const { family: _parent, ...rest } = variant; next = upsertMovement(next, removed.family ? { ...rest, family: removed.family } : rest); }
  return next;
}

/** Merge records into one: every merged name and alias resolves to the target, variants re-parent, the target's own data stays. */
export function mergeMovements(data: MasterData, ids: string[], targetId: string): MasterData {
  const catalogue = effectiveCatalogue(data);
  const target = catalogue.get(targetId);
  if (!target) return data;
  let next = data;
  for (const id of ids) {
    if (id === targetId) continue;
    const source = catalogue.get(id);
    if (!source) continue;
    const aliases = { ...next.movementAliases };
    for (const spelling of [source.name, ...(source.aliases ?? [])]) if (movementKey(spelling) !== movementKey(target.name)) aliases[spelling] = targetId;
    for (const [spelling, pointed] of Object.entries(aliases)) if (pointed === id) aliases[spelling] = targetId;
    next = { ...next, movementAliases: aliases };
    for (const variant of catalogue.variants(id)) next = upsertMovement(next, { ...variant, family: targetId });
    next = { ...next, movements: next.movements.filter(item => item.id !== id), hiddenMovements: seedIds.has(id) ? [...new Set([...next.hiddenMovements, id])] : next.hiddenMovements };
  }
  return next;
}

export function removeMovementAlias(data: MasterData, spelling: string): MasterData {
  const movementAliases = { ...data.movementAliases };
  delete movementAliases[spelling];
  return { ...data, movementAliases };
}

/** Loads for a prescription from its record (or the record's family head), as prescription levels for the given sex. */
export function defaultLoad(catalogue: Catalogue, prescription: { movement?: string; name: string }, sex: Sex): Prescription['load'] | undefined {
  const record = catalogue.resolve(prescription);
  if (!record) return undefined;
  const loads = record.loads ?? catalogue.head(record).loads;
  if (!loads) return undefined;
  const group = loads[sex];
  const toValue = (value: number): LoadValue | undefined => value > 0 ? { value, unit: loads.unit } : undefined;
  const result = { light: toValue(group.light), medium: toValue(group.medium), heavy: toValue(group.heavy) };
  const defined = Object.fromEntries(Object.entries(result).filter(([, value]) => value));
  return Object.keys(defined).length ? defined as Prescription['load'] : undefined;
}

/** A workout's own levels win; a single value or no load falls back to the catalogue when it knows the movement. */
export function effectiveLoad(catalogue: Catalogue, prescription: Prescription, sex: Sex): Prescription['load'] | undefined {
  if (prescription.load && !('value' in prescription.load)) return prescription.load;
  return defaultLoad(catalogue, prescription, sex) ?? prescription.load;
}

// ---- Collections ---------------------------------------------------------------------------------------------

export function upsertCollection(data: MasterData, collection: Collection): MasterData {
  const rest = data.collections.filter(item => item.id !== collection.id);
  return { ...data, collections: [...rest, collection] };
}

export function removeCollection(data: MasterData, id: string): MasterData {
  return { ...data, collections: data.collections.filter(item => item.id !== id) };
}

export function collectionsOf(collections: Collection[], workoutId: string): Collection[] {
  return collections.filter(collection => collection.workoutIds.includes(workoutId));
}

