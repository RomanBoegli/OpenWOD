import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { emptyMasterData, isEmptyMasterData, mergeMasterData, sanitiseMasterData, type MasterData } from '../../../../packages/domain/src/master-data';
import type { PackCollection } from '../../../../packages/domain/src/pack';
import type { Workout } from '../../../../packages/domain/src/schema';
import type { SectionResult } from '../../../../packages/engine/src';
import type { SessionRecord } from '../../../../packages/engine/src/records';
import { loadMasterData } from '../master-data';
import { loadSavedWorkouts } from '../library-store';
import { loadSessions } from '../session-log';
import { ApiError, NetworkError } from './client';
import { deviceId } from './device';
import { idbGet, idbPut, StorageUnavailableError } from './idb';
import type { ExportDocument, RestoreReport } from '../../../../packages/household/src/types';
import { backend, type BackendCounts } from './backend';
import { DATA_MODE, type DataMode } from './mode';
import { clearOutbox, deleteSessionItemId, enqueue, flush, listOutbox, MASTER_ITEM_ID, outboxEvents, removeOutboxItem, requeue, sessionItemId, type OutboxItem } from './outbox';
import { clearSession, finishSession, listRecoveries, type Recovery } from './checkpoints';
import type { DeviceImportReport, PackDecision, PackImportReport, SessionListItem, StoredWorkout } from './remote';

/**
 * The household's data as this device sees it (DAT-01/02/09): the server is authoritative, an IndexedDB cache makes
 * boot instant and offline reads possible, and writes that cannot reach the server wait in the outbox, labelled.
 * In the static shape (mode.ts) the backend is this browser's IndexedDB: there is no cache, nothing goes offline,
 * and the outbox empties as soon as it is flushed.
 */
export type Connection = 'starting' | 'online' | 'offline' | 'unreachable';
export type SaveResult = 'saved' | 'queued' | 'failed' | { conflict: { revision: number; document?: Workout } };
export interface SessionView extends SessionListItem { pending?: boolean }
export interface LegacyData { workouts: Workout[]; masterData: MasterData; sessions: SessionRecord[] }
export interface LibraryData {
  mode: DataMode;
  saved: StoredWorkout[];
  /** True once the first load has answered (or failed), so a missing workout can be told from one still loading. */
  loaded: boolean;
  masterData: MasterData;
  masterRevision: number;
  sessions: SessionView[];
  connection: Connection;
  schemaVersion?: number;
  serverVersion?: string;
  /** Workout and session ids waiting in the outbox. */
  pendingIds: Set<string>;
  conflicts: OutboxItem[];
  rejected: OutboxItem[];
  notice: string;
  legacy?: LegacyData;
  migrating: boolean;
  /** Static shape only: what this browser holds. */
  stats?: BackendCounts;
  saveWorkout: (workout: Workout, expectedRevision: number) => Promise<SaveResult>;
  archiveWorkout: (id: string) => Promise<void>;
  updateMasterData: (change: (current: MasterData) => MasterData) => void;
  recordSession: (record: SessionRecord) => Promise<void>;
  /** Sessions interrupted on this device, newest first (ENG-12). */
  recoveries: Recovery[];
  /** False until this device's checkpoints have been read once; the player waits for it so a recovery is never missed. */
  recoveriesReady: boolean;
  clearRecovery: (sessionId: string) => Promise<void>;
  refreshRecoveries: () => Promise<void>;
  correctSession: (id: string, results: SectionResult[], note?: string) => Promise<boolean>;
  /** Deletes a session for good (DAT-14): gone from the list at once, from this device's outbox, and from the household. */
  deleteSession: (id: string) => Promise<boolean>;
  /** Reads the next page of sessions; false when it was the last. */
  loadMoreSessions: () => Promise<boolean>;
  fetchSession: (id: string) => Promise<(SessionRecord & { receivedAt: string }) | undefined>;
  importPack: (workouts: Workout[], collections: PackCollection[], decisions: Record<string, PackDecision>) => Promise<PackImportReport>;
  migrateDevice: () => Promise<DeviceImportReport | undefined>;
  resolveConflict: (item: OutboxItem, decision: 'copy' | 'discard', freeId?: string) => Promise<void>;
  dismissRejected: (item: OutboxItem) => Promise<void>;
  refresh: () => Promise<void>;
  clearNotice: () => void;
  /** Everything as one restorable JSON document (DAT-11). */
  exportAll: () => Promise<ExportDocument>;
  /** Replaces the household with a backup, drops queued writes, and reads everything again. */
  restore: (document: unknown) => Promise<RestoreReport & { backup?: string }>;
}

interface Cache { workouts: StoredWorkout[]; master: { revision: number; document: MasterData }; sessions: SessionListItem[]; fetchedAt: string }
const SESSION_PAGE = 50;
const LEGACY_KEYS = ['openwod.library.v1', 'openwod.master.v1', 'openwod.sessions.v1'];
const MIGRATION_KEY = 'migration';
const STATIC = DATA_MODE === 'static';
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const NO_STORAGE = "This browser's storage is not available. Workouts play, but nothing can be saved.";
const NO_STORAGE_CHANGE = 'This browser cannot store anything: browser storage is unavailable. The change is lost when this page closes.';

const toView = (record: SessionRecord): SessionView => { const { events: _events, workout: _workout, ...rest } = record; return { ...rest, receivedAt: '', pending: true }; };

export function useLibraryData(): LibraryData {
  const [saved, setSaved] = useState<StoredWorkout[]>([]);
  const [masterData, setMasterData] = useState<MasterData>(emptyMasterData);
  const [masterRevision, setMasterRevision] = useState(0);
  const [serverSessions, setServerSessions] = useState<SessionListItem[]>([]);
  const [connection, setConnection] = useState<Connection>('starting');
  /** True once the first load has answered, so a workout link is only called missing after the library is known. */
  const [loaded, setLoaded] = useState(false);
  const [ready, setReady] = useState<{ schemaVersion?: number; version?: string }>({});
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [notice, setNotice] = useState('');
  const [legacy, setLegacy] = useState<LegacyData>();
  const [migrating, setMigrating] = useState(false);
  const [stats, setStats] = useState<BackendCounts>();
  const [recoveries, setRecoveries] = useState<Recovery[]>([]);
  const [recoveriesReady, setRecoveriesReady] = useState(false);
  const refreshRecoveries = useCallback(async () => { try { setRecoveries(await listRecoveries()); } catch { setRecoveries([]); } finally { setRecoveriesReady(true); } }, []);
  const clearRecovery = useCallback(async (sessionId: string) => { try { await clearSession(sessionId); } catch { /* nothing to clear */ } await refreshRecoveries(); }, [refreshRecoveries]);
  const masterRef = useRef({ document: masterData, revision: masterRevision });
  masterRef.current = { document: masterData, revision: masterRevision };

  const readOutbox = useCallback(async () => { try { setOutbox(await listOutbox()); } catch { /* no storage: nothing is queued */ } }, []);

  // The cache holds the server's document as it came, possibly from an older build: it is sanitised like any stored copy.
  const applyCache = useCallback((cache: Cache) => { setSaved(cache.workouts); setMasterData(sanitiseMasterData(cache.master.document)); setMasterRevision(cache.master.revision); setServerSessions(cache.sessions); }, []);
  // The static shape keeps no cache: the household itself is already in this browser.
  const writeCache = useCallback((cache: Omit<Cache, 'fetchedAt'>) => STATIC ? Promise.resolve() : idbPut('cache', { key: 'household', ...cache, fetchedAt: new Date().toISOString() }).catch(() => undefined), []);

  const fetchAll = useCallback(async () => {
    const [workouts, master, sessions] = await Promise.all([backend.listWorkouts(), backend.getMasterData(), backend.listSessions({ limit: SESSION_PAGE })]);
    setSaved(workouts); setMasterData(master.document); setMasterRevision(master.revision); setServerSessions(sessions);
    void writeCache({ workouts, master, sessions });
    if (backend.counts) void backend.counts().then(setStats, () => undefined);
  }, [writeCache]);

  const refresh = useCallback(async () => {
    if (STATIC) {
      // Nothing to reach: the library is always "online"; only the browser's storage can fail.
      setConnection('online');
      try {
        const status = await backend.ready();
        setReady({ schemaVersion: status.schemaVersion, version: status.version });
        await fetchAll();
        void flush();
      } catch (error) { setNotice(error instanceof StorageUnavailableError ? NO_STORAGE : error instanceof Error ? error.message : String(error)); }
      setLoaded(true);
      return;
    }
    try {
      const status = await backend.ready();
      setReady({ schemaVersion: status.schemaVersion, version: status.version });
      await fetchAll();
      setConnection('online');
      void flush();
    } catch (error) {
      setConnection(error instanceof NetworkError || (error instanceof ApiError && error.status === 503) ? (navigator.onLine === false ? 'offline' : 'unreachable') : 'unreachable');
    }
    setLoaded(true);
  }, [fetchAll]);

  /** Static shape: moves pre-1.0 data from localStorage into this browser's library without asking (same import as the server's). */
  const migrateLegacy = useCallback(async (data: LegacyData) => {
    try {
      const report = await backend.importDevice({ deviceId: deviceId(), workouts: data.workouts, masterData: data.masterData, sessions: data.sessions });
      for (const key of LEGACY_KEYS) { try { localStorage.removeItem(key); } catch { /* fine */ } }
      try { await idbPut('meta', { key: MIGRATION_KEY, value: new Date().toISOString() }); } catch { /* fine */ }
      setNotice(`Moved ${plural(report.workouts.created, 'workout')} and ${plural(report.sessions.created, 'session')} into this browser's library.`);
      await fetchAll();
    } catch (error) { setNotice(error instanceof StorageUnavailableError ? NO_STORAGE : error instanceof Error ? error.message : String(error)); }
  }, [fetchAll]);

  // Boot: cache first for an instant library, then the server; legacy device data is offered for migration.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!STATIC) { try { const cache = await idbGet<Cache & { key: string }>('cache', 'household'); if (cache && !cancelled) applyCache(cache); } catch { /* no cache */ } }
      await readOutbox();
      await refreshRecoveries();
      if (cancelled) return;
      await refresh();
      try {
        const done = await idbGet<{ key: string; value: unknown }>('meta', MIGRATION_KEY);
        if (done) return;
      } catch { /* no storage: still offer, the server side is idempotent */ }
      const workouts = loadSavedWorkouts();
      const master = loadMasterData();
      const sessions = loadSessions();
      if (cancelled || !(workouts.length || sessions.length || !isEmptyMasterData(master))) return;
      if (STATIC) await migrateLegacy({ workouts, masterData: master, sessions }); else setLegacy({ workouts, masterData: master, sessions });
    })();
    return () => { cancelled = true; };
  }, [applyCache, readOutbox, refresh, refreshRecoveries, migrateLegacy]);

  // Outbox: react to changes, retry on reconnect and while anything is pending.
  useEffect(() => {
    const onChange = () => { void readOutbox(); };
    outboxEvents.addEventListener('change', onChange);
    const online = () => { setConnection('starting'); void refresh(); };
    const offline = () => setConnection('offline');
    const visible = () => { if (document.visibilityState === 'visible') void flush().then(result => { if (result.uploaded.length) void fetchAll().catch(() => undefined); }); };
    // The static shape never goes offline: the network does not matter to it.
    if (!STATIC) { window.addEventListener('online', online); window.addEventListener('offline', offline); }
    document.addEventListener('visibilitychange', visible);
    return () => { outboxEvents.removeEventListener('change', onChange); window.removeEventListener('online', online); window.removeEventListener('offline', offline); document.removeEventListener('visibilitychange', visible); };
  }, [readOutbox, refresh, fetchAll]);
  const pendingCount = outbox.filter(item => item.state === 'pending').length;
  useEffect(() => {
    if (!pendingCount) return;
    const timer = setInterval(() => { void flush().then(result => { if (result.uploaded.length) { void fetchAll().catch(() => undefined); if (connection !== 'online') void refresh(); } }); }, 15_000);
    return () => clearInterval(timer);
  }, [pendingCount, fetchAll, refresh, connection]);

  const queue = useCallback(async (item: Parameters<typeof enqueue>[0]) => {
    try { await enqueue(item); } catch (error) { setNotice(error instanceof StorageUnavailableError ? (STATIC ? NO_STORAGE_CHANGE : 'This device cannot keep changes for later: browser storage is unavailable. The change is lost unless the server comes back while this page stays open.') : String(error)); throw error; }
  }, []);

  const saveWorkout = useCallback(async (workout: Workout, expectedRevision: number): Promise<SaveResult> => {
    const stamp = new Date().toISOString();
    const previous = saved;
    setSaved(current => { const index = current.findIndex(item => item.id === workout.id); const next: StoredWorkout = { id: workout.id, revision: workout.revision, origin: current[index]?.origin ?? 'local', createdAt: current[index]?.createdAt ?? stamp, updatedAt: stamp, document: workout }; return index === -1 ? [next, ...current] : current.map((item, at) => at === index ? next : item); });
    try {
      await backend.putWorkout(workout, expectedRevision);
      void fetchAll().catch(() => undefined);
      return 'saved';
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) { setSaved(previous); return { conflict: (error.payload?.current ?? { revision: 0 }) as { revision: number; document?: Workout } }; }
      if (error instanceof NetworkError) {
        try { await queue({ id: `workout:${workout.id}`, kind: 'workout', body: workout, expectedRevision }); void flush(); return 'queued'; } catch { setSaved(previous); return 'failed'; }
      }
      setSaved(previous);
      setNotice(error instanceof Error ? error.message : String(error));
      return 'failed';
    }
  }, [saved, fetchAll, queue]);

  const archiveWorkout = useCallback(async (id: string) => {
    const existing = saved.find(item => item.id === id);
    setSaved(current => current.filter(item => item.id !== id));
    try { await backend.archiveWorkout(id, existing?.revision); } catch (error) {
      if (error instanceof NetworkError) { try { await queue({ id: `archive:${id}`, kind: 'archive', body: { id }, expectedRevision: existing?.revision }); } catch { /* noticed */ } return; }
      if (error instanceof ApiError && error.status === 404) return;
      setNotice(error instanceof Error ? error.message : String(error));
      void fetchAll().catch(() => undefined);
    }
  }, [saved, fetchAll, queue]);

  const pushMaster = useCallback(async (document: MasterData, expected: number) => {
    try {
      const result = await backend.putMasterData(document, expected);
      setMasterRevision(result.revision);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const server = await backend.getMasterData();
        const merged = mergeMasterData(document, server.document);
        setMasterData(merged);
        const result = await backend.putMasterData(merged, server.revision);
        setMasterRevision(result.revision);
        return;
      }
      if (error instanceof NetworkError) { await queue({ id: MASTER_ITEM_ID, kind: 'master', body: document, expectedRevision: expected }); return; }
      throw error;
    }
  }, [queue]);

  const updateMasterData = useCallback((change: (current: MasterData) => MasterData) => {
    const next = change(masterRef.current.document);
    const expected = masterRef.current.revision;
    masterRef.current = { document: next, revision: expected };
    setMasterData(next);
    void pushMaster(next, expected).catch(error => setNotice(error instanceof Error ? error.message : String(error)));
  }, [pushMaster]);

  // One transaction ends the session on this device: checkpoint and progress out, the record into the outbox (DAT-02).
  const recordSession = useCallback(async (record: SessionRecord) => {
    try { await finishSession(record.id, record); } catch (error) {
      setNotice(error instanceof StorageUnavailableError ? (STATIC ? NO_STORAGE_CHANGE : 'This device cannot keep the session for later: browser storage is unavailable. It uploads now if the server answers, otherwise it is lost.') : String(error));
      try { await backend.putSession(record); void fetchAll().catch(() => undefined); } catch { /* reported above */ }
      return;
    }
    await refreshRecoveries();
    const result = await flush();
    if (result.uploaded.length) void fetchAll().catch(() => undefined);
  }, [fetchAll, refreshRecoveries]);

  const correctSession = useCallback(async (id: string, results: SectionResult[], note?: string) => {
    const session = serverSessions.find(item => item.id === id);
    if (!session) return false;
    try {
      const result = await backend.correctSession(id, results, note, session.revision ?? 1);
      setServerSessions(current => current.map(item => item.id === id ? { ...item, results, revision: result.revision } : item));
      return true;
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); return false; }
  }, [serverSessions]);

  const deleteSession = useCallback(async (id: string) => {
    setServerSessions(current => current.filter(item => item.id !== id));
    // A session still waiting for its upload on this device goes with it, and so does its row in the read cache.
    try { await removeOutboxItem(sessionItemId(id)); } catch { /* no storage: nothing was queued */ }
    if (!STATIC) void idbGet<Cache & { key: string }>('cache', 'household').then(cache => cache ? idbPut('cache', { ...cache, sessions: cache.sessions.filter(item => item.id !== id) }) : undefined).catch(() => undefined);
    // The household is told even then: an upload that reached it without an answer is deleted, one still on its way meets the tombstone.
    try {
      await backend.deleteSession(id);
      void fetchAll().catch(() => undefined);
      return true;
    } catch (error) {
      if (error instanceof NetworkError) { try { await queue({ id: deleteSessionItemId(id), kind: 'deleteSession', body: { id } }); return true; } catch { return false; } }
      setNotice(error instanceof Error ? error.message : String(error));
      void fetchAll().catch(() => undefined);
      return false;
    }
  }, [fetchAll, queue]);

  const loadMoreSessions = useCallback(async () => {
    const last = serverSessions[serverSessions.length - 1];
    if (!last) return false;
    try { const more = await backend.listSessions({ limit: SESSION_PAGE, before: last.finishedAt }); setServerSessions(current => [...current, ...more.filter(item => !current.some(existing => existing.id === item.id))]); return more.length >= SESSION_PAGE; } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); return true; }
  }, [serverSessions]);

  const fetchSession = useCallback(async (id: string) => { try { return await backend.getSession(id); } catch { return undefined; } }, []);

  const importPack = useCallback(async (workouts: Workout[], collections: PackCollection[], decisions: Record<string, PackDecision>) => {
    const report = await backend.importPack({ workouts, collections, decisions });
    await fetchAll();
    return report;
  }, [fetchAll]);

  const migrateDevice = useCallback(async () => {
    if (!legacy) return undefined;
    setMigrating(true);
    try {
      const report = await backend.importDevice({ deviceId: deviceId(), workouts: legacy.workouts, masterData: legacy.masterData, sessions: legacy.sessions });
      for (const key of LEGACY_KEYS) { try { localStorage.removeItem(key); } catch { /* fine */ } }
      try { await idbPut('meta', { key: MIGRATION_KEY, value: new Date().toISOString() }); } catch { /* fine */ }
      setLegacy(undefined);
      await fetchAll();
      return report;
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); return undefined; } finally { setMigrating(false); }
  }, [legacy, fetchAll]);

  const resolveConflict = useCallback(async (item: OutboxItem, decision: 'copy' | 'discard', freeId?: string) => {
    if (decision === 'discard' || item.kind !== 'workout' || !freeId) { await removeOutboxItem(item.id); void fetchAll().catch(() => undefined); return; }
    const document = { ...(item.body as Workout), id: freeId, revision: 1 };
    await requeue({ ...item, id: `workout:${freeId}` }, { body: document, expectedRevision: 0 });
    await removeOutboxItem(item.id);
    void flush().then(() => fetchAll().catch(() => undefined));
  }, [fetchAll]);
  const dismissRejected = useCallback(async (item: OutboxItem) => { await removeOutboxItem(item.id); }, []);

  const exportAll = useCallback(() => backend.exportAll(), []);
  // Queued writes belong to the household that was just replaced, so they go too (they would conflict or resurrect it).
  const restore = useCallback(async (document: unknown) => {
    const report = await backend.restore(document);
    try { await clearOutbox(); } catch { /* no storage: nothing was queued */ }
    await fetchAll();
    return report;
  }, [fetchAll]);

  const sessions = useMemo<SessionView[]>(() => {
    if (STATIC) return serverSessions;
    const pending = outbox.filter(item => item.kind === 'session').map(item => toView(item.body as SessionRecord));
    const known = new Set(serverSessions.map(item => item.id));
    const deleted = new Set(outbox.filter(item => item.kind === 'deleteSession').map(item => (item.body as { id: string }).id));
    return [...pending.filter(item => !known.has(item.id)), ...serverSessions].filter(item => !deleted.has(item.id)).sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
  }, [outbox, serverSessions]);
  const pendingIds = useMemo(() => STATIC ? new Set<string>() : new Set(outbox.filter(item => item.state === 'pending').map(item => item.kind === 'session' ? (item.body as SessionRecord).id : item.kind === 'workout' ? (item.body as Workout).id : item.kind === 'archive' || item.kind === 'deleteSession' ? (item.body as { id: string }).id : MASTER_ITEM_ID)), [outbox]);
  const savedWithQueued = useMemo(() => {
    const queued = outbox.filter(item => item.kind === 'workout' && item.state === 'pending').map(item => item.body as Workout).filter(workout => !saved.some(item => item.id === workout.id));
    const archived = new Set(outbox.filter(item => item.kind === 'archive' && item.state === 'pending').map(item => (item.body as { id: string }).id));
    return [...saved.filter(item => !archived.has(item.id)), ...queued.map((document): StoredWorkout => ({ id: document.id, revision: document.revision, origin: 'local', createdAt: '', updatedAt: '', document }))];
  }, [saved, outbox]);

  return {
    mode: DATA_MODE, stats, exportAll, restore,
    saved: savedWithQueued, loaded, masterData, masterRevision, sessions, connection, schemaVersion: ready.schemaVersion, serverVersion: ready.version, pendingIds,
    conflicts: outbox.filter(item => item.state === 'conflict'), rejected: outbox.filter(item => item.state === 'rejected'), notice, legacy, migrating,
    saveWorkout, archiveWorkout, updateMasterData, recordSession, recoveries, recoveriesReady, clearRecovery, refreshRecoveries, correctSession, deleteSession, loadMoreSessions, fetchSession, importPack, migrateDevice, resolveConflict, dismissRejected, refresh, clearNotice: () => setNotice(''),
  };
}
