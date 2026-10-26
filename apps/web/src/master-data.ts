import { equipmentKey, normalise } from '../../../packages/domain/src/library';
import type { LoadLevel, LoadValue, Prescription } from '../../../packages/domain/src/schema';
import { benchmarkWorkouts, coachWorkouts, fixtureWorkouts } from '../../../packages/domain/src/fixtures';

/**
 * Master data kept on this device until the server milestone: equipment spellings (merges), collections of workouts,
 * and default loads per movement for men and women. Everything here is presentation and organisation; it never changes
 * a workout file.
 */
export interface Collection { id: string; title: string; description?: string; workoutIds: string[]; builtIn?: boolean }
export type Sex = 'men' | 'women';
export interface MovementLoads { name: string; unit: 'kg' | 'lb'; men: Record<LoadLevel, number>; women: Record<LoadLevel, number> }
export interface MasterData {
  /** Equipment key (see equipmentKey) → canonical display name. */
  equipmentAliases: Record<string, string>;
  collections: Collection[];
  movementLoads: MovementLoads[];
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
export const emptyMasterData = (): MasterData => ({ equipmentAliases: {}, collections: [], movementLoads: [] });

const text = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const level = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(10_000, value) : 0;

export function loadMasterData(): MasterData {
  try {
    const raw = localStorage.getItem(KEY);
    const stored = raw ? JSON.parse(raw) as Partial<MasterData> : {};
    const aliases: Record<string, string> = {};
    if (stored.equipmentAliases && typeof stored.equipmentAliases === 'object') for (const [key, name] of Object.entries(stored.equipmentAliases)) if (text(key, 80) && text(name, 80)) aliases[equipmentKey(key)] = text(name, 80);
    const collections: Collection[] = Array.isArray(stored.collections) ? stored.collections.filter((item): item is Collection => Boolean(item && typeof item === 'object' && typeof item.id === 'string' && typeof item.title === 'string' && Array.isArray(item.workoutIds))).slice(0, 50).map(item => ({ id: text(item.id, 120), title: text(item.title, 120) || 'Collection', ...(item.description ? { description: text(item.description, 500) } : {}), workoutIds: item.workoutIds.filter((id): id is string => typeof id === 'string').slice(0, 500) })) : [];
    const movementLoads: MovementLoads[] = Array.isArray(stored.movementLoads) ? stored.movementLoads.filter((item): item is MovementLoads => Boolean(item && typeof item === 'object' && typeof item.name === 'string' && item.men && item.women)).slice(0, 300).map(item => ({ name: text(item.name, 160), unit: item.unit === 'lb' ? 'lb' : 'kg', men: { light: level(item.men.light), medium: level(item.men.medium), heavy: level(item.men.heavy) }, women: { light: level(item.women.light), medium: level(item.women.medium), heavy: level(item.women.heavy) } })) : [];
    return { equipmentAliases: aliases, collections, movementLoads };
  } catch { return emptyMasterData(); }
}

export function persistMasterData(data: MasterData): string | undefined {
  try { localStorage.setItem(KEY, JSON.stringify(data)); return undefined; } catch { return 'This device could not save your settings. They last for this visit only.'; }
}

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

export const movementKey = (name: string) => normalise(name).replace(/\s+/g, ' ');

/** Loads for a movement from master data, as prescription levels for the given sex, or undefined when unknown. */
export function defaultLoad(data: MasterData, movement: string, sex: Sex): Prescription['load'] | undefined {
  const entry = data.movementLoads.find(item => movementKey(item.name) === movementKey(movement));
  if (!entry) return undefined;
  const loads = entry[sex];
  const toValue = (value: number): LoadValue | undefined => value > 0 ? { value, unit: entry.unit } : undefined;
  const result = { light: toValue(loads.light), medium: toValue(loads.medium), heavy: toValue(loads.heavy) };
  const defined = Object.fromEntries(Object.entries(result).filter(([, value]) => value));
  return Object.keys(defined).length ? defined as Prescription['load'] : undefined;
}

/** A workout's own levels win; a single value or no load falls back to the movement table when it knows the movement. */
export function effectiveLoad(data: MasterData, prescription: Prescription, sex: Sex): Prescription['load'] | undefined {
  if (prescription.load && !('value' in prescription.load)) return prescription.load;
  return defaultLoad(data, prescription.name, sex) ?? prescription.load;
}

export function upsertMovementLoads(data: MasterData, entry: MovementLoads): MasterData {
  const rest = data.movementLoads.filter(item => movementKey(item.name) !== movementKey(entry.name));
  return { ...data, movementLoads: [...rest, entry].sort((a, b) => a.name.localeCompare(b.name, 'en')) };
}

export function removeMovementLoads(data: MasterData, name: string): MasterData {
  return { ...data, movementLoads: data.movementLoads.filter(item => movementKey(item.name) !== movementKey(name)) };
}

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
