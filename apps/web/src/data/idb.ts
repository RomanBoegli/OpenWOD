/**
 * IndexedDB for what must survive a reload on this device (DAT-02): session checkpoints and progress records, the
 * outbox of writes still to reach the server, a read cache of the household data for instant and offline boot, and
 * small metadata. Every failure surfaces as StorageUnavailableError; callers decide what that means for the user.
 */
export const IDB_NAME = 'openwod';
export const IDB_VERSION = 1;
export type StoreName = 'checkpoints' | 'progress' | 'outbox' | 'cache' | 'meta';

export class StorageUnavailableError extends Error {
  constructor(message = 'Browser storage is not available.') { super(message); this.name = 'StorageUnavailableError'; }
}

let opening: Promise<IDBDatabase> | undefined;

export function openIdb(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new StorageUnavailableError()); return; }
    let request: IDBOpenDBRequest;
    try { request = indexedDB.open(IDB_NAME, IDB_VERSION); } catch (error) { reject(new StorageUnavailableError(String(error))); return; }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('checkpoints')) db.createObjectStore('checkpoints', { keyPath: 'sessionId' }).createIndex('byWorkout', 'workoutId');
      if (!db.objectStoreNames.contains('progress')) db.createObjectStore('progress', { keyPath: 'sessionId' });
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'id' }).createIndex('byState', 'state');
      if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); opening = undefined; };
      resolve(db);
    };
    request.onerror = () => reject(new StorageUnavailableError(request.error?.message));
    request.onblocked = () => reject(new StorageUnavailableError('Another tab holds an older version of the database.'));
  });
  opening.catch(() => { opening = undefined; });
  return opening;
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
export const idbClear = (store: StoreName): Promise<void> => transaction([store], 'readwrite', get => { get(store).clear(); });
export { settle };
