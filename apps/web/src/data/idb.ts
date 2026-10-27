/**
 * IndexedDB for what must survive a reload on this device (DAT-02): session checkpoints and progress records, the
 * outbox of writes still to reach the server, a read cache of the household data for instant and offline boot, and
 * small metadata. Version 2 adds the household itself for the static shape (local-backend.ts): workouts, the master
 * data row and sessions with their corrections. Version 3 adds `deletedSessions`, the tombstones of deleted session
 * ids (DAT-14), and changes nothing else. Every failure surfaces as StorageUnavailableError; callers decide
 * what that means for the user.
 */
export const IDB_NAME = 'openwod';
export const IDB_VERSION = 3;
export type HouseholdStoreName = 'workouts' | 'master' | 'sessions' | 'deletedSessions';
export type StoreName = 'checkpoints' | 'progress' | 'outbox' | 'cache' | 'meta' | HouseholdStoreName;

export class StorageUnavailableError extends Error {
  constructor(message = 'Browser storage is not available.') { super(message); this.name = 'StorageUnavailableError'; }
}

let opening: Promise<IDBDatabase> | undefined;

/**
 * Creates whatever store or index is missing, so every upgrade path (fresh, from 1 or 2, a half-finished earlier attempt)
 * ends in the same shape. Existing stores and their rows are never touched.
 */
function upgrade(db: IDBDatabase, tx: IDBTransaction | null) {
  if (!db.objectStoreNames.contains('checkpoints')) db.createObjectStore('checkpoints', { keyPath: 'sessionId' }).createIndex('byWorkout', 'workoutId');
  if (!db.objectStoreNames.contains('progress')) db.createObjectStore('progress', { keyPath: 'sessionId' });
  if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'id' }).createIndex('byState', 'state');
  if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', { keyPath: 'key' });
  if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
  if (!db.objectStoreNames.contains('workouts')) db.createObjectStore('workouts', { keyPath: 'id' });
  if (!db.objectStoreNames.contains('master')) db.createObjectStore('master', { keyPath: 'id' });
  const sessions = db.objectStoreNames.contains('sessions') ? tx?.objectStore('sessions') : db.createObjectStore('sessions', { keyPath: 'id' });
  if (sessions && !sessions.indexNames.contains('byFinished')) sessions.createIndex('byFinished', 'finishedAt');
  if (sessions && !sessions.indexNames.contains('byWorkout')) sessions.createIndex('byWorkout', ['workoutId', 'finishedAt']);
  if (!db.objectStoreNames.contains('deletedSessions')) db.createObjectStore('deletedSessions', { keyPath: 'id' });
}

/** Opens (and upgrades) the database of a factory, uncached. The app goes through openIdb; tests open their own. */
export function openDatabase(factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB, name = IDB_NAME): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (!factory) { reject(new StorageUnavailableError()); return; }
    let request: IDBOpenDBRequest;
    try { request = factory.open(name, IDB_VERSION); } catch (error) { reject(new StorageUnavailableError(String(error))); return; }
    request.onupgradeneeded = () => upgrade(request.result, request.transaction);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new StorageUnavailableError(request.error?.message));
    request.onblocked = () => reject(new StorageUnavailableError('Another tab holds an older version of the database.'));
  });
}

export function openIdb(): Promise<IDBDatabase> {
  opening ??= openDatabase().then(db => {
    db.onversionchange = () => { db.close(); opening = undefined; };
    return db;
  });
  opening.catch(() => { opening = undefined; });
  return opening;
}

/** Closes the shared connection; the next call opens it again (tests swap the factory in between). */
export async function closeIdb(): Promise<void> {
  const current = opening;
  opening = undefined;
  if (!current) return;
  try { (await current).close(); } catch { /* never opened */ }
}

const settle = <T,>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(new StorageUnavailableError(request.error?.message));
});

/** Runs `fn` inside one transaction over the given stores; the returned promise settles when the transaction commits. */
export async function transaction<T>(stores: StoreName[], mode: IDBTransactionMode, fn: (get: (name: StoreName) => IDBObjectStore) => Promise<T> | T): Promise<T> {
  const db = await openIdb();
  return new Promise<T>((resolve, reject) => {
    let tx: IDBTransaction;
    try { tx = db.transaction(stores, mode); } catch (error) { reject(new StorageUnavailableError(String(error))); return; }
    let result: T;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(new StorageUnavailableError(tx.error?.message));
    tx.onabort = () => reject(new StorageUnavailableError(tx.error?.message ?? 'The transaction was aborted.'));
    Promise.resolve(fn(name => tx.objectStore(name))).then(value => { result = value; }).catch(error => { try { tx.abort(); } catch { /* already done */ } reject(error); });
  });
}

export const idbGet = <T,>(store: StoreName, key: IDBValidKey): Promise<T | undefined> => transaction([store], 'readonly', get => settle(get(store).get(key) as IDBRequest<T | undefined>));
export const idbGetAll = <T,>(store: StoreName): Promise<T[]> => transaction([store], 'readonly', get => settle(get(store).getAll() as IDBRequest<T[]>));
export const idbPut = (store: StoreName, value: unknown): Promise<void> => transaction([store], 'readwrite', get => { get(store).put(value); });
export const idbDelete = (store: StoreName, key: IDBValidKey): Promise<void> => transaction([store], 'readwrite', get => { get(store).delete(key); });
export { settle };
