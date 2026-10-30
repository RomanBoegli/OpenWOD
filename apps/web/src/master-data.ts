import { Catalogue, movementKey, type Movement } from '../../../packages/domain/src/catalogue';
import { authorKey, equipmentKey } from '../../../packages/domain/src/library';
import { seedMovements } from '../../../packages/domain/src/movements';

/**
 * Master data on this device: the household document (see packages/domain/src/master-data.ts) plus the editing
 * helpers the settings pages use. Browser storage keeps a copy until the server milestone; every read is sanitised.
 */
import { emptyMasterData, sanitiseMasterData, builtInCollections, editFor, type Collection, type CollectionEdit, type MasterData } from '../../../packages/domain/src/master-data';
export { emptyMasterData, sanitiseMasterData, builtInCollections, mergeMasterData, isEmptyMasterData, type Collection, type CollectionEdit, type MasterData } from '../../../packages/domain/src/master-data';
export type { Movement };
export type { Sex } from '../../../packages/domain/src/prescription';

const KEY = 'openwod.master.v1';

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

export function loadMasterData(): MasterData {
  try { return sanitiseMasterData(JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { return emptyMasterData(); }
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

// ---- Authors ----------------------------------------------------------------------------------------------------

/** The spelling an author takes after merges and renames. */
export const authorSpelling = (data: MasterData) => (name: string): string => data.authorAliases[authorKey(name)] ?? name.trim();

/** The author as the library shows it: the spelling after merges, or nothing for a deleted one. Workout files keep their own text. */
export const canonicalAuthor = (data: MasterData) => (name: string): string | undefined => {
  const canonical = authorSpelling(data)(name);
  return canonical && !data.hiddenAuthors.includes(authorKey(canonical)) ? canonical : undefined;
};

/** Authors to pick from: those the library names (already canonical) and those added by hand, minus deleted ones. */
export function authorRepertoire(data: MasterData, libraryAuthors: string[]): string[] {
  const seen = new Map<string, string>();
  for (const name of [...libraryAuthors, ...data.authors.map(author => canonicalAuthor(data)(author) ?? '')]) if (name.trim() && !seen.has(authorKey(name))) seen.set(authorKey(name), name.trim());
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}

/** Merge every spelling in `names` into `target`, re-pointing earlier merges into any of them. Like mergeEquipment. */
export function mergeAuthors(data: MasterData, names: string[], target: string): MasterData {
  const canonical = target.trim();
  if (!canonical) return data;
  const keys = new Set(names.map(authorKey).filter(Boolean));
  const aliases = { ...data.authorAliases };
  for (const key of keys) aliases[key] = canonical;
  for (const [key, value] of Object.entries(aliases)) if (keys.has(authorKey(value))) aliases[key] = canonical;
  // A hand-added spelling that was merged away becomes the target, once.
  const renamed = data.authors.map(author => keys.has(authorKey(author)) ? canonical : author);
  return { ...data, authorAliases: aliases, authors: [...new Map(renamed.map(author => [authorKey(author), author])).values()] };
}

export function unmergeAuthor(data: MasterData, key: string): MasterData {
  const aliases = { ...data.authorAliases };
  delete aliases[key];
  return { ...data, authorAliases: aliases, committed: data.committed.filter(entry => entry !== `author:${key}`) };
}

/** Adds an author by hand; a deleted one with the same spelling comes back. */
export function addAuthor(data: MasterData, name: string): MasterData {
  const author = name.trim();
  if (!author) return data;
  const restored = restoreAuthor(data, author);
  return restored.authors.some(item => authorKey(item) === authorKey(author)) ? restored : { ...restored, authors: [...restored.authors, author] };
}

/**
 * Deletes an author: it leaves the lists, suggestions, search and pages. One that workouts name (`used`) is hidden,
 * so they show no author and Restore can bring it back; one only added by hand is simply forgotten.
 */
export function removeAuthor(data: MasterData, name: string, used: boolean): MasterData {
  const key = authorKey(name);
  const authors = data.authors.filter(author => authorKey(author) !== key);
  return { ...data, authors, hiddenAuthors: !used || data.hiddenAuthors.includes(key) ? data.hiddenAuthors : [...data.hiddenAuthors, key] };
}

export function restoreAuthor(data: MasterData, name: string): MasterData {
  const key = authorKey(name);
  return data.hiddenAuthors.includes(key) ? { ...data, hiddenAuthors: data.hiddenAuthors.filter(item => item !== key) } : data;
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

