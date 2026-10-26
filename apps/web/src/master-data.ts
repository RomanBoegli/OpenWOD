import { Catalogue, movementKey, type Movement } from '../../../packages/domain/src/catalogue';
import { equipmentKey } from '../../../packages/domain/src/library';
import { seedMovements } from '../../../packages/domain/src/movements';
import { bundledCollections } from '../../../packages/domain/src/bundled';

/**
 * Master data kept on this device until the server milestone: equipment spellings (merges), collections of workouts,
 * and the movement catalogue (your own records, overrides of bundled ones, merges and removals). Everything here is
 * presentation and organisation; it never changes a workout file.
 */
export interface Collection { id: string; title: string; description?: string; workoutIds: string[]; builtIn?: boolean }
/** Your changes to a bundled collection, kept as a delta so a workout added to the registry later still shows up. */
export interface CollectionEdit { title?: string; description?: string; added: string[]; removed: string[] }
export type { Movement };
export type { Sex } from '../../../packages/domain/src/prescription';
export interface MasterData {
  /** Equipment key (see equipmentKey) → canonical display name. */
  equipmentAliases: Record<string, string>;
  collections: Collection[];
  /** Edits to bundled collections by id. */
  collectionEdits: Record<string, CollectionEdit>;
  /** Your movement records: new ones, and overrides of bundled records with the same id. */
  movements: Movement[];
  /** Bundled record ids you removed. */
  hiddenMovements: string[];
  /** Extra spellings → record id, from merges and renames ("Wall-ball shots" → wall-ball). */
  movementAliases: Record<string, string>;
  /** Merges you committed: they keep working but no longer appear in the history with an Undo. */
  committed: string[];
}

const KEY = 'openwod.master.v1';

/** Collections that ship with the app: one per registry folder with a collection.yaml. They are not editable; your own collections sit beside them. */
export const builtInCollections: Collection[] = bundledCollections.map(collection => ({ ...collection, builtIn: true }));

/** Bundled collections first with your edits applied, then your own. A workout in one of your collections is not shown under a bundled one. */
export const allCollections = (data: MasterData): Collection[] => {
  const own = data.collections.filter(collection => !builtInCollections.some(item => item.id === collection.id));
  const claimed = new Set(own.flatMap(collection => collection.workoutIds));
  const bundled = builtInCollections.map(collection => {
    const edit = data.collectionEdits[collection.id];
    const workoutIds = [...collection.workoutIds.filter(id => !edit?.removed.includes(id)), ...(edit?.added ?? []).filter(id => !collection.workoutIds.includes(id))].filter(id => !claimed.has(id));
    return { ...collection, ...(edit?.title ? { title: edit.title } : {}), ...(edit?.description !== undefined ? { description: edit.description } : {}), workoutIds, builtIn: true };
  });
  return [...bundled, ...own];
};
export const emptyMasterData = (): MasterData => ({ equipmentAliases: {}, collections: [], collectionEdits: {}, movements: [], hiddenMovements: [], movementAliases: {}, committed: [] });

const text = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const strings = (value: unknown, max: number, each = 80) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, max).map(item => item.trim().slice(0, each)) : [];
const MOVEMENT_LIMIT = 600;

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
  if (text(item.notes, 500)) record.notes = text(item.notes, 500);
  return record;
}

export function loadMasterData(): MasterData {
  try {
    const raw = localStorage.getItem(KEY);
    const stored = raw ? JSON.parse(raw) as Partial<MasterData> : {};
    const aliases: Record<string, string> = {};
    if (stored.equipmentAliases && typeof stored.equipmentAliases === 'object') for (const [key, name] of Object.entries(stored.equipmentAliases)) if (text(key, 80) && text(name, 80)) aliases[equipmentKey(key)] = text(name, 80);
    const collections: Collection[] = Array.isArray(stored.collections) ? stored.collections.filter((item): item is Collection => Boolean(item && typeof item === 'object' && typeof item.id === 'string' && typeof item.title === 'string' && Array.isArray(item.workoutIds))).slice(0, 50).map(item => ({ id: text(item.id, 120), title: text(item.title, 120) || 'Collection', ...(item.description ? { description: text(item.description, 500) } : {}), workoutIds: item.workoutIds.filter((id): id is string => typeof id === 'string').slice(0, 500) })) : [];
    const movements = (Array.isArray(stored.movements) ? stored.movements : []).map(readMovement).filter((item): item is Movement => Boolean(item)).slice(0, MOVEMENT_LIMIT);
    const hiddenMovements = strings(stored.hiddenMovements, MOVEMENT_LIMIT);
    const movementAliases: Record<string, string> = {};
    if (stored.movementAliases && typeof stored.movementAliases === 'object') for (const [key, id] of Object.entries(stored.movementAliases)) if (text(key, 160) && text(id, 80)) movementAliases[text(key, 160)] = text(id, 80);
    const collectionEdits: Record<string, CollectionEdit> = {};
    if (stored.collectionEdits && typeof stored.collectionEdits === 'object') for (const [id, edit] of Object.entries(stored.collectionEdits as Record<string, Partial<CollectionEdit>>)) if (builtInCollections.some(item => item.id === id) && edit && typeof edit === 'object') collectionEdits[id] = { ...(text(edit.title, 120) ? { title: text(edit.title, 120) } : {}), ...(typeof edit.description === 'string' ? { description: text(edit.description, 500) } : {}), added: strings(edit.added, 500, 120), removed: strings(edit.removed, 500, 120) };
    // Earlier builds stored an edited bundled collection as a full copy under its id; that becomes a delta.
    for (const copy of collections.filter(item => builtInCollections.some(bundled => bundled.id === item.id))) collectionEdits[copy.id] = editFor(builtInCollections.find(bundled => bundled.id === copy.id)!, copy);
    return { equipmentAliases: aliases, collections: collections.filter(item => !builtInCollections.some(bundled => bundled.id === item.id)), collectionEdits, movements, hiddenMovements, movementAliases, committed: strings(stored.committed, 2000, 200) };
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

/** Keeps a merge or rename for good and drops it from the history list. */
export function commitMerge(data: MasterData, entry: string): MasterData {
  return data.committed.includes(entry) ? data : { ...data, committed: [...data.committed, entry] };
}

export function unmergeEquipment(data: MasterData, key: string): MasterData {
  const aliases = { ...data.equipmentAliases };
  delete aliases[key];
  return { ...data, equipmentAliases: aliases, committed: data.committed.filter(entry => entry !== `equipment:${key}`) };
}

// ---- Movement catalogue ---------------------------------------------------------------------------------------

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

/** Drops every change to the bundled records (overrides, removals and merge aliases); your own records stay. */
export function restoreBundledMovements(data: MasterData): MasterData {
  return { ...data, movements: data.movements.filter(record => !seedIds.has(record.id)), hiddenMovements: [], movementAliases: {}, committed: data.committed.filter(entry => !entry.startsWith('movement:')) };
}

export function removeMovementAlias(data: MasterData, spelling: string): MasterData {
  const movementAliases = { ...data.movementAliases };
  delete movementAliases[spelling];
  return { ...data, movementAliases, committed: data.committed.filter(entry => entry !== `movement:${spelling}`) };
}

// ---- Collections ---------------------------------------------------------------------------------------------

/**
 * Replaces a collection in place (so editing never reorders the list) or appends a new one. A workout belongs to one
 * of your collections at a time: the ids it now holds leave every other collection of yours.
 */
/** The delta between a bundled collection and the version the user saved. */
function editFor(bundled: Collection, edited: Collection): CollectionEdit {
  return {
    ...(edited.title.trim() && edited.title.trim() !== bundled.title ? { title: edited.title.trim() } : {}),
    ...((edited.description ?? '') !== (bundled.description ?? '') ? { description: edited.description ?? '' } : {}),
    added: edited.workoutIds.filter(id => !bundled.workoutIds.includes(id)),
    removed: bundled.workoutIds.filter(id => !edited.workoutIds.includes(id)),
  };
}

/**
 * Saves a collection: a bundled one as a delta against the registry, your own in place (so editing never reorders
 * the list) or appended. A workout belongs to one collection at a time, so the ids it now holds leave every other
 * collection of yours and are marked removed on every bundled one that listed them.
 */
export function upsertCollection(data: MasterData, collection: Collection): MasterData {
  const { builtIn: _flag, ...stored } = collection;
  const bundled = builtInCollections.find(item => item.id === stored.id);
  const ids = new Set(stored.workoutIds);
  const collectionEdits = Object.fromEntries(builtInCollections.filter(item => item.id !== stored.id).map(item => {
    const edit = data.collectionEdits[item.id] ?? { added: [], removed: [] };
    const removed = [...new Set([...edit.removed, ...item.workoutIds.filter(id => ids.has(id))])];
    return [item.id, { ...edit, added: edit.added.filter(id => !ids.has(id)), removed }];
  }).filter(([, edit]) => (edit as CollectionEdit).added.length || (edit as CollectionEdit).removed.length || (edit as CollectionEdit).title || (edit as CollectionEdit).description !== undefined));
  const others = (item: Collection): Collection => ({ ...item, workoutIds: item.workoutIds.filter(id => !ids.has(id)) });
  if (bundled) return { ...data, collections: data.collections.map(others), collectionEdits: { ...collectionEdits, [bundled.id]: editFor(bundled, stored) } };
  const index = data.collections.findIndex(item => item.id === stored.id);
  const collections = index === -1 ? [...data.collections.map(others), stored] : data.collections.map((item, at) => at === index ? stored : others(item));
  return { ...data, collections, collectionEdits };
}

/** The one collection a workout is shown under: yours first, then the bundled one its file sits in. */
export function collectionOf(collections: Collection[], workoutId: string): Collection | undefined {
  const matching = collections.filter(collection => collection.workoutIds.includes(workoutId));
  return matching.find(collection => !collection.builtIn) ?? matching[0];
}

export function removeCollection(data: MasterData, id: string): MasterData {
  return { ...data, collections: data.collections.filter(item => item.id !== id) };
}

export function collectionsOf(collections: Collection[], workoutId: string): Collection[] {
  return collections.filter(collection => collection.workoutIds.includes(workoutId));
}

