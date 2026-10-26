import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { emptyMasterData, isEmptyMasterData, mergeMasterData, type MasterData } from '../../../../packages/domain/src/master-data';
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
import { enqueue, flush, listOutbox, MASTER_ITEM_ID, outboxEvents, removeOutboxItem, requeue, type OutboxItem } from './outbox';
import { clearSession, finishSession, listRecoveries, type Recovery } from './checkpoints';
import { remote, type DeviceImportReport, type PackDecision, type PackImportReport, type SessionListItem, type StoredWorkout } from './remote';

/**
 * The household's data as this device sees it (DAT-01/02/09): the server is authoritative, an IndexedDB cache makes
 * boot instant and offline reads possible, and writes that cannot reach the server wait in the outbox, labelled.
 */
export type Connection = 'starting' | 'online' | 'offline' | 'unreachable';
export type SaveResult = 'saved' | 'queued' | 'failed' | { conflict: { revision: number; document?: Workout } };
export interface SessionView extends SessionListItem { pending?: boolean }
export interface LegacyData { workouts: Workout[]; masterData: MasterData; sessions: SessionRecord[] }
export interface LibraryData {
  saved: StoredWorkout[];
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
  loadMoreSessions: () => Promise<void>;
  fetchSession: (id: string) => Promise<(SessionRecord & { receivedAt: string }) | undefined>;
  importPack: (workouts: Workout[], collections: PackCollection[], decisions: Record<string, PackDecision>) => Promise<PackImportReport>;
  migrateDevice: () => Promise<DeviceImportReport | undefined>;
  resolveConflict: (item: OutboxItem, decision: 'copy' | 'discard', freeId?: string) => Promise<void>;
  dismissRejected: (item: OutboxItem) => Promise<void>;
  refresh: () => Promise<void>;
  clearNotice: () => void;
}

interface Cache { workouts: StoredWorkout[]; master: { revision: number; document: MasterData }; sessions: SessionListItem[]; fetchedAt: string }
const SESSION_PAGE = 50;
const LEGACY_KEYS = ['openwod.library.v1', 'openwod.master.v1', 'openwod.sessions.v1'];
const MIGRATION_KEY = 'migration';

const toView = (record: SessionRecord): SessionView => { const { events: _events, workout: _workout, ...rest } = record; return { ...rest, receivedAt: '', pending: true }; };

export function useLibraryData(): LibraryData {
  const [saved, setSaved] = useState<StoredWorkout[]>([]);
  const [masterData, setMasterData] = useState<MasterData>(emptyMasterData);
  const [masterRevision, setMasterRevision] = useState(0);
  const [serverSessions, setServerSessions] = useState<SessionListItem[]>([]);
  const [connection, setConnection] = useState<Connection>('starting');
  const [ready, setReady] = useState<{ schemaVersion?: number; version?: string }>({});
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [notice, setNotice] = useState('');
  const [legacy, setLegacy] = useState<LegacyData>();
  const [migrating, setMigrating] = useState(false);
  const [recoveries, setRecoveries] = useState<Recovery[]>([]);
  const [recoveriesReady, setRecoveriesReady] = useState(false);
  const refreshRecoveries = useCallback(async () => { try { setRecoveries(await listRecoveries()); } catch { setRecoveries([]); } finally { setRecoveriesReady(true); } }, []);
  const clearRecovery = useCallback(async (sessionId: string) => { try { await clearSession(sessionId); } catch { /* nothing to clear */ } await refreshRecoveries(); }, [refreshRecoveries]);
  const masterRef = useRef({ document: masterData, revision: masterRevision });
  masterRef.current = { document: masterData, revision: masterRevision };

  const readOutbox = useCallback(async () => { try { setOutbox(await listOutbox()); } catch { /* no storage: nothing is queued */ } }, []);

  const applyCache = useCallback((cache: Cache) => { setSaved(cache.workouts); setMasterData(cache.master.document); setMasterRevision(cache.master.revision); setServerSessions(cache.sessions); }, []);
  const writeCache = useCallback((cache: Omit<Cache, 'fetchedAt'>) => idbPut('cache', { key: 'household', ...cache, fetchedAt: new Date().toISOString() }).catch(() => undefined), []);

  const fetchAll = useCallback(async () => {
    const [workouts, master, sessions] = await Promise.all([remote.listWorkouts(), remote.getMasterData(), remote.listSessions({ limit: SESSION_PAGE })]);
    setSaved(workouts); setMasterData(master.document); setMasterRevision(master.revision); setServerSessions(sessions);
    void writeCache({ workouts, master, sessions });
  }, [writeCache]);

  const refresh = useCallback(async () => {
    try {
      const status = await remote.ready();
      setReady({ schemaVersion: status.schemaVersion, version: status.version });
      await fetchAll();
      setConnection('online');
      void flush();
    } catch (error) {
      setConnection(error instanceof NetworkError || (error instanceof ApiError && error.status === 503) ? (navigator.onLine === false ? 'offline' : 'unreachable') : 'unreachable');
    }
  }, [fetchAll]);

  // Boot: cache first for an instant library, then the server; legacy device data is offered for migration.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try { const cache = await idbGet<Cache & { key: string }>('cache', 'household'); if (cache && !cancelled) applyCache(cache); } catch { /* no cache */ }
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
      if (!cancelled && (workouts.length || sessions.length || !isEmptyMasterData(master))) setLegacy({ workouts, masterData: master, sessions });
    })();
    return () => { cancelled = true; };
  }, [applyCache, readOutbox, refresh, refreshRecoveries]);

  // Outbox: react to changes, retry on reconnect and while anything is pending.
  useEffect(() => {
    const onChange = () => { void readOutbox(); };
    outboxEvents.addEventListener('change', onChange);
    const online = () => { setConnection('starting'); void refresh(); };
    const offline = () => setConnection('offline');
    const visible = () => { if (document.visibilityState === 'visible') void flush().then(result => { if (result.uploaded.length) void fetchAll().catch(() => undefined); }); };
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
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
    try { await enqueue(item); } catch (error) { setNotice(error instanceof StorageUnavailableError ? 'This device cannot keep changes for later: browser storage is unavailable. The change is lost unless the server comes back while this page stays open.' : String(error)); throw error; }
  }, []);

  const saveWorkout = useCallback(async (workout: Workout, expectedRevision: number): Promise<SaveResult> => {
    const stamp = new Date().toISOString();
    const previous = saved;
    setSaved(current => { const index = current.findIndex(item => item.id === workout.id); const next: StoredWorkout = { id: workout.id, revision: workout.revision, origin: current[index]?.origin ?? 'local', createdAt: current[index]?.createdAt ?? stamp, updatedAt: stamp, document: workout }; return index === -1 ? [next, ...current] : current.map((item, at) => at === index ? next : item); });
    try {
      await remote.putWorkout(workout, expectedRevision);
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
    try { await remote.archiveWorkout(id, existing?.revision); } catch (error) {
      if (error instanceof NetworkError) { try { await queue({ id: `archive:${id}`, kind: 'archive', body: { id }, expectedRevision: existing?.revision }); } catch { /* noticed */ } return; }
      if (error instanceof ApiError && error.status === 404) return;
      setNotice(error instanceof Error ? error.message : String(error));
      void fetchAll().catch(() => undefined);
    }
  }, [saved, fetchAll, queue]);

  const pushMaster = useCallback(async (document: MasterData, expected: number) => {
    try {
      const result = await remote.putMasterData(document, expected);
      setMasterRevision(result.revision);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const server = await remote.getMasterData();
        const merged = mergeMasterData(document, server.document);
        setMasterData(merged);
        const result = await remote.putMasterData(merged, server.revision);
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
      setNotice(error instanceof StorageUnavailableError ? 'This device cannot keep the session for later: browser storage is unavailable. It uploads now if the server answers, otherwise it is lost.' : String(error));
      try { await remote.putSession(record); void fetchAll().catch(() => undefined); } catch { /* reported above */ }
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
      const result = await remote.correctSession(id, results, note, session.revision ?? 1);
      setServerSessions(current => current.map(item => item.id === id ? { ...item, results, revision: result.revision } : item));
      return true;
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); return false; }
  }, [serverSessions]);

  const loadMoreSessions = useCallback(async () => {
    const last = serverSessions[serverSessions.length - 1];
    if (!last) return;
    try { const more = await remote.listSessions({ limit: SESSION_PAGE, before: last.finishedAt }); setServerSessions(current => [...current, ...more.filter(item => !current.some(existing => existing.id === item.id))]); } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  }, [serverSessions]);

  const fetchSession = useCallback(async (id: string) => { try { return await remote.getSession(id); } catch { return undefined; } }, []);

  const importPack = useCallback(async (workouts: Workout[], collections: PackCollection[], decisions: Record<string, PackDecision>) => {
    const report = await remote.importPack({ workouts, collections, decisions });
    await fetchAll();
    return report;
  }, [fetchAll]);

  const migrateDevice = useCallback(async () => {
    if (!legacy) return undefined;
    setMigrating(true);
    try {
      const report = await remote.importDevice({ deviceId: deviceId(), workouts: legacy.workouts, masterData: legacy.masterData, sessions: legacy.sessions });
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

  const sessions = useMemo<SessionView[]>(() => {
    const pending = outbox.filter(item => item.kind === 'session').map(item => toView(item.body as SessionRecord));
    const known = new Set(serverSessions.map(item => item.id));
    return [...pending.filter(item => !known.has(item.id)), ...serverSessions].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
  }, [outbox, serverSessions]);
  const pendingIds = useMemo(() => new Set(outbox.filter(item => item.state === 'pending').map(item => item.kind === 'session' ? (item.body as SessionRecord).id : item.kind === 'workout' ? (item.body as Workout).id : item.kind === 'archive' ? (item.body as { id: string }).id : MASTER_ITEM_ID)), [outbox]);
  const savedWithQueued = useMemo(() => {
    const queued = outbox.filter(item => item.kind === 'workout' && item.state === 'pending').map(item => item.body as Workout).filter(workout => !saved.some(item => item.id === workout.id));
    const archived = new Set(outbox.filter(item => item.kind === 'archive' && item.state === 'pending').map(item => (item.body as { id: string }).id));
    return [...saved.filter(item => !archived.has(item.id)), ...queued.map((document): StoredWorkout => ({ id: document.id, revision: document.revision, origin: 'local', createdAt: '', updatedAt: '', document }))];
  }, [saved, outbox]);

  return {
    saved: savedWithQueued, masterData, masterRevision, sessions, connection, schemaVersion: ready.schemaVersion, serverVersion: ready.version, pendingIds,
    conflicts: outbox.filter(item => item.state === 'conflict'), rejected: outbox.filter(item => item.state === 'rejected'), notice, legacy, migrating,
    saveWorkout, archiveWorkout, updateMasterData, recordSession, recoveries, recoveriesReady, clearRecovery, refreshRecoveries, correctSession, loadMoreSessions, fetchSession, importPack, migrateDevice, resolveConflict, dismissRejected, refresh, clearNotice: () => setNotice(''),
  };
}
