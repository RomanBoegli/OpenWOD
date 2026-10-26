import { Type, type Static } from '@sinclair/typebox';
import type { Movement } from './catalogue';
import { equipmentKey } from './library';
import { bundledCollections } from './bundled';

/**
 * Master data: equipment spellings (merges), collections of workouts, and the movement catalogue (your own records,
 * overrides of bundled ones, merges and removals). Everything here is presentation and organisation; it never
 * changes a workout file. One document per household, kept on the server with a revision, cached on each device.
 */
export interface Collection { id: string; title: string; description?: string; workoutIds: string[]; builtIn?: boolean }
/** Your changes to a bundled collection, kept as a delta so a workout added to the registry later still shows up. */
export interface CollectionEdit { title?: string; description?: string; added: string[]; removed: string[] }
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

export const COLLECTION_LIMIT = 50;
export const COLLECTION_SIZE = 500;
export const MOVEMENT_LIMIT = 600;
export const MOVEMENT_CATEGORIES = ['weightlifting', 'gymnastics', 'monostructural', 'strength', 'conditioning', 'mobility'] as const;

const name = (max: number) => Type.String({ minLength: 1, maxLength: max });
const CollectionSchema = Type.Object({
  id: name(120), title: name(120), description: Type.Optional(Type.String({ maxLength: 500 })),
  workoutIds: Type.Array(name(120), { maxItems: COLLECTION_SIZE }), builtIn: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });
const CollectionEditSchema = Type.Object({
  title: Type.Optional(name(120)), description: Type.Optional(Type.String({ maxLength: 500 })),
  added: Type.Array(name(120), { maxItems: COLLECTION_SIZE }), removed: Type.Array(name(120), { maxItems: COLLECTION_SIZE }),
}, { additionalProperties: false });
const MovementRecordSchema = Type.Object({
  id: Type.String({ pattern: '^[a-z0-9][a-z0-9-]{0,79}$' }), name: name(160),
  shortName: Type.Optional(name(60)), spokenName: Type.Optional(name(160)), aliases: Type.Optional(Type.Array(name(160), { maxItems: 20 })),
  family: Type.Optional(name(80)), equipment: Type.Optional(Type.Array(name(80), { maxItems: 10 })),
  category: Type.Optional(Type.Union(MOVEMENT_CATEGORIES.map(category => Type.Literal(category)))), notes: Type.Optional(Type.String({ maxLength: 500 })),
}, { additionalProperties: false });
/** The server validates a master-data document against this; the client sanitises with the same bounds on read. */
export const MasterDataSchema = Type.Object({
  equipmentAliases: Type.Record(Type.String({ maxLength: 80 }), Type.String({ maxLength: 80 })),
  collections: Type.Array(CollectionSchema, { maxItems: COLLECTION_LIMIT }),
  collectionEdits: Type.Record(Type.String({ maxLength: 120 }), CollectionEditSchema),
  movements: Type.Array(MovementRecordSchema, { maxItems: MOVEMENT_LIMIT }),
  hiddenMovements: Type.Array(name(80), { maxItems: MOVEMENT_LIMIT }),
  movementAliases: Type.Record(Type.String({ maxLength: 160 }), Type.String({ maxLength: 80 })),
  committed: Type.Array(name(200), { maxItems: 2000 }),
}, { $id: 'MasterData', additionalProperties: false });
export type MasterDataDocument = Static<typeof MasterDataSchema>;

/** Collections that ship with the app: one per registry folder with a collection.yaml. They are not editable; your own collections sit beside them. */
export const builtInCollections: Collection[] = bundledCollections.map(collection => ({ ...collection, builtIn: true }));

export const emptyMasterData = (): MasterData => ({ equipmentAliases: {}, collections: [], collectionEdits: {}, movements: [], hiddenMovements: [], movementAliases: {}, committed: [] });

const text = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const strings = (value: unknown, max: number, each = 80) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, max).map(item => item.trim().slice(0, each)) : [];

export function readMovement(value: unknown): Movement | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as Partial<Movement>;
  const id = text(item.id, 80);
  const movementName = text(item.name, 160);
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id) || !movementName) return undefined;
  const record: Movement = { id, name: movementName };
  if (text(item.shortName, 60)) record.shortName = text(item.shortName, 60);
  if (text(item.spokenName, 160)) record.spokenName = text(item.spokenName, 160);
  const aliases = strings(item.aliases, 20, 160);
  if (aliases.length) record.aliases = aliases;
  if (text(item.family, 80)) record.family = text(item.family, 80);
  const equipment = strings(item.equipment, 10);
  if (equipment.length) record.equipment = equipment;
  if (typeof item.category === 'string' && (MOVEMENT_CATEGORIES as readonly string[]).includes(item.category)) record.category = item.category as Movement['category'];
  if (text(item.notes, 500)) record.notes = text(item.notes, 500);
  return record;
}

/** The delta between a bundled collection and the version the user saved. */
export function editFor(bundled: Collection, edited: Collection): CollectionEdit {
  return {
    ...(edited.title.trim() && edited.title.trim() !== bundled.title ? { title: edited.title.trim() } : {}),
    ...((edited.description ?? '') !== (bundled.description ?? '') ? { description: edited.description ?? '' } : {}),
    added: edited.workoutIds.filter(id => !bundled.workoutIds.includes(id)),
    removed: bundled.workoutIds.filter(id => !edited.workoutIds.includes(id)),
  };
}

/**
 * Reads a stored or received document into a well-formed MasterData, dropping anything out of bounds. Any failure
 * yields the empty document, never a partial one. Earlier builds stored an edited bundled collection as a full copy
 * under its id; that becomes a delta.
 */
export function sanitiseMasterData(value: unknown): MasterData {
  try {
    const stored = (value && typeof value === 'object' ? value : {}) as Partial<MasterData>;
    const aliases: Record<string, string> = {};
    if (stored.equipmentAliases && typeof stored.equipmentAliases === 'object') for (const [key, alias] of Object.entries(stored.equipmentAliases)) if (text(key, 80) && text(alias, 80)) aliases[equipmentKey(key)] = text(alias, 80);
    const collections: Collection[] = Array.isArray(stored.collections) ? stored.collections.filter((item): item is Collection => Boolean(item && typeof item === 'object' && typeof item.id === 'string' && typeof item.title === 'string' && Array.isArray(item.workoutIds))).slice(0, COLLECTION_LIMIT).map(item => ({ id: text(item.id, 120), title: text(item.title, 120) || 'Collection', ...(item.description ? { description: text(item.description, 500) } : {}), workoutIds: item.workoutIds.filter((id): id is string => typeof id === 'string').slice(0, COLLECTION_SIZE) })) : [];
    const movements = (Array.isArray(stored.movements) ? stored.movements : []).map(readMovement).filter((item): item is Movement => Boolean(item)).slice(0, MOVEMENT_LIMIT);
    const hiddenMovements = strings(stored.hiddenMovements, MOVEMENT_LIMIT);
    const movementAliases: Record<string, string> = {};
    if (stored.movementAliases && typeof stored.movementAliases === 'object') for (const [key, id] of Object.entries(stored.movementAliases)) if (text(key, 160) && text(id, 80)) movementAliases[text(key, 160)] = text(id, 80);
    const collectionEdits: Record<string, CollectionEdit> = {};
    if (stored.collectionEdits && typeof stored.collectionEdits === 'object') for (const [id, edit] of Object.entries(stored.collectionEdits as Record<string, Partial<CollectionEdit>>)) if (builtInCollections.some(item => item.id === id) && edit && typeof edit === 'object') collectionEdits[id] = { ...(text(edit.title, 120) ? { title: text(edit.title, 120) } : {}), ...(typeof edit.description === 'string' ? { description: text(edit.description, 500) } : {}), added: strings(edit.added, COLLECTION_SIZE, 120), removed: strings(edit.removed, COLLECTION_SIZE, 120) };
    for (const copy of collections.filter(item => builtInCollections.some(bundled => bundled.id === item.id))) collectionEdits[copy.id] = editFor(builtInCollections.find(bundled => bundled.id === copy.id)!, copy);
    return { equipmentAliases: aliases, collections: collections.filter(item => !builtInCollections.some(bundled => bundled.id === item.id)), collectionEdits, movements, hiddenMovements, movementAliases, committed: strings(stored.committed, 2000, 200) };
  } catch { return emptyMasterData(); }
}

/**
 * Merges a second document into a base one without losing either side: the base wins where both name the same
 * key or id, the incoming side fills the gaps. Used when a device's data moves to the server and when a write hits
 * a newer revision.
 */
export function mergeMasterData(base: MasterData, incoming: MasterData): MasterData {
  const collections = [...base.collections];
  for (const collection of incoming.collections) if (!collections.some(item => item.id === collection.id)) collections.push(collection);
  const collectionEdits = { ...incoming.collectionEdits, ...base.collectionEdits };
  const movements = [...base.movements];
  for (const record of incoming.movements) if (!movements.some(item => item.id === record.id)) movements.push(record);
  return {
    equipmentAliases: { ...incoming.equipmentAliases, ...base.equipmentAliases },
    collections: collections.slice(0, COLLECTION_LIMIT),
    collectionEdits,
    movements: movements.slice(0, MOVEMENT_LIMIT),
    hiddenMovements: [...new Set([...base.hiddenMovements, ...incoming.hiddenMovements])].slice(0, MOVEMENT_LIMIT),
    movementAliases: { ...incoming.movementAliases, ...base.movementAliases },
    committed: [...new Set([...base.committed, ...incoming.committed])].slice(0, 2000),
  };
}

export const isEmptyMasterData = (data: MasterData): boolean =>
  !Object.keys(data.equipmentAliases).length && !data.collections.length && !Object.keys(data.collectionEdits).length && !data.movements.length && !data.hiddenMovements.length && !Object.keys(data.movementAliases).length && !data.committed.length;
