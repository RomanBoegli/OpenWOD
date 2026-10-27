import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { loadPreferences, normalisePreferences, savePreferences, type Preferences } from '../preferences';
import { request } from './client';
import { DATA_MODE } from './mode';

/**
 * Settings are the household's in the server shape: every device follows one document on the server, and the last
 * change wins. This browser's copy makes boot instant and covers offline use; a change made offline is marked and
 * sent on the next focus, reconnect or change. The static shape has no server, so its settings stay in this browser.
 */
const SHARED = DATA_MODE === 'server';
const SYNC_KEY = 'openwod.preferences.sync';
const PUSH_DELAY_MS = 400;

interface SyncState { revision: number; dirty: boolean }
interface ServerSettings { revision: number; document?: unknown }

function loadSync(): SyncState {
  try {
    const stored = JSON.parse(localStorage.getItem(SYNC_KEY) ?? '{}') as Partial<SyncState>;
    return { revision: Number.isInteger(stored.revision) && stored.revision! >= 0 ? stored.revision! : 0, dirty: stored.dirty === true };
  } catch { return { revision: 0, dirty: false }; }
}
function saveSync(state: SyncState) {
  try { localStorage.setItem(SYNC_KEY, JSON.stringify(state)); } catch { /* The flag then lasts for this visit only. */ }
}

export function useSharedPreferences(): [Preferences, Dispatch<SetStateAction<Preferences>>] {
  const [preferences, setLocal] = useState(loadPreferences);
  const latest = useRef(preferences);
  latest.current = preferences;
  const sync = useRef<SyncState>(SHARED ? loadSync() : { revision: 0, dirty: false });
  /** Counts local changes, so a change made while a push is under way keeps the device marked. */
  const edits = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => savePreferences(preferences), [preferences]);

  const mark = useCallback((state: SyncState) => { sync.current = state; saveSync(state); }, []);

  /** Sends this device's settings. Pushes run one after another, so the server always ends on the newest. */
  const push = useCallback(() => {
    queue.current = queue.current.then(async () => {
      const edit = edits.current;
      try {
        const result = await request<{ revision: number }>('PUT', '/settings', { body: { document: latest.current } });
        mark({ revision: result.revision, dirty: edits.current !== edit });
      } catch { /* Still marked: the next focus, reconnect or change sends it again. */ }
    });
    return queue.current;
  }, [mark]);

  /** Follows the household: a marked device sends its change first, an empty server takes this device's settings unless they are the defaults. */
  const pull = useCallback(async () => {
    if (sync.current.dirty) return push();
    let server: ServerSettings;
    try { server = await request<ServerSettings>('GET', '/settings'); } catch { return; }
    if (sync.current.dirty) return;
    if (!server.document) {
      if (JSON.stringify(latest.current) === JSON.stringify(normalisePreferences({}))) return;
      mark({ ...sync.current, dirty: true });
      return push();
    }
    if (server.revision === sync.current.revision) return;
    mark({ revision: server.revision, dirty: false });
    setLocal(normalisePreferences(server.document));
  }, [mark, push]);

  useEffect(() => {
    if (!SHARED) return;
    void pull();
    const visible = () => { if (document.visibilityState === 'visible') void pull(); };
    const again = () => { void pull(); };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('focus', again);
    window.addEventListener('online', again);
    return () => { document.removeEventListener('visibilitychange', visible); window.removeEventListener('focus', again); window.removeEventListener('online', again); clearTimeout(timer.current); };
  }, [pull]);

  const update = useCallback<Dispatch<SetStateAction<Preferences>>>(action => {
    setLocal(action);
    if (!SHARED) return;
    edits.current++;
    mark({ ...sync.current, dirty: true });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { void push(); }, PUSH_DELAY_MS);
  }, [mark, push]);

  return [preferences, update];
}
