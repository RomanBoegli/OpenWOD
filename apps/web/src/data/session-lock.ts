/**
 * One tab controls a session (ENG-14): a Web Lock named by the session id is held by the controlling tab and released
 * by the browser when that tab goes away. A BroadcastChannel on the same name carries the takeover: the claiming tab
 * asks, the holder pauses, writes its last checkpoint, releases, and says so. Without Web Locks the channel alone
 * answers a ping, which is best-effort.
 */
const lockName = (sessionId: string) => `openwod.session.${sessionId}`;
type Message = { type: 'claim' } | { type: 'released' } | { type: 'ping' } | { type: 'alive' };

const channel = (sessionId: string) => ('BroadcastChannel' in window ? new BroadcastChannel(lockName(sessionId)) : undefined);
const hasLocks = () => typeof navigator !== 'undefined' && 'locks' in navigator && Boolean(navigator.locks);

/** Does a live tab answer on the session's channel? */
function ping(sessionId: string, waitMs = 400): Promise<boolean> {
  const bc = channel(sessionId);
  if (!bc) return Promise.resolve(false);
  return new Promise(resolve => {
    const timer = setTimeout(() => { bc.close(); resolve(false); }, waitMs);
    bc.onmessage = (event: MessageEvent<Message>) => { if (event.data?.type === 'alive') { clearTimeout(timer); bc.close(); resolve(true); } };
    bc.postMessage({ type: 'ping' } satisfies Message);
  });
}

/**
 * Is another tab controlling this session right now? The lock decides, but a lock whose holder does not answer a
 * ping is a document on its way out (a reload releases its lock a moment after the next document loads), so the
 * channel has the last word.
 */
export async function probeSessionLock(sessionId: string): Promise<'free' | 'held'> {
  if (hasLocks()) {
    try {
      let free = false;
      await navigator.locks.request(lockName(sessionId), { ifAvailable: true }, lock => { free = Boolean(lock); return Promise.resolve(); });
      if (free) return 'free';
    } catch { /* fall through to the channel */ }
  }
  return (await ping(sessionId)) ? 'held' : 'free';
}

export interface HeldLock { release: () => void }

/**
 * Holds the lock for a session this tab controls. `onClaim` runs when another tab asks for it; the caller pauses,
 * flushes its checkpoint and then calls `release`, which also announces the release on the channel.
 */
export function holdSessionLock(sessionId: string, { onClaim }: { onClaim: () => void }): HeldLock {
  const bc = channel(sessionId);
  let releaseLock: (() => void) | undefined;
  let released = false;
  if (bc) bc.onmessage = (event: MessageEvent<Message>) => {
    if (released) return;
    if (event.data?.type === 'ping') bc.postMessage({ type: 'alive' } satisfies Message);
    if (event.data?.type === 'claim') onClaim();
  };
  if (hasLocks()) {
    void navigator.locks.request(lockName(sessionId), { ifAvailable: true }, lock => {
      if (!lock || released) return Promise.resolve();
      return new Promise<void>(resolve => { releaseLock = resolve; });
    }).catch(() => undefined);
  }
  // A reload or navigation lets go before the next document probes, so a tab never blocks itself.
  const onHide = () => release();
  window.addEventListener('pagehide', onHide, { once: true });
  const release = () => {
      if (released) return;
      released = true;
      window.removeEventListener('pagehide', onHide);
      releaseLock?.();
      // Silence and close at once: a document on its way out must not answer the next document's ping.
      if (bc) { bc.onmessage = null; try { bc.postMessage({ type: 'released' } satisfies Message); } catch { /* channel closed */ } bc.close(); }
  };
  return { release };
}

/** Asks the controlling tab to hand the session over and waits (up to 3 s) until the lock is free. */
export async function takeOverSession(sessionId: string): Promise<void> {
  const bc = channel(sessionId);
  const releasedByHolder = new Promise<void>(resolve => {
    if (!bc) { resolve(); return; }
    bc.onmessage = (event: MessageEvent<Message>) => { if (event.data?.type === 'released') resolve(); };
    bc.postMessage({ type: 'claim' } satisfies Message);
  });
  const timeout = new Promise<void>(resolve => setTimeout(resolve, 3000));
  await Promise.race([releasedByHolder, timeout]);
  if (hasLocks()) {
    // The holder released; wait for the browser to hand the lock over before reading the final checkpoint.
    await Promise.race([navigator.locks.request(lockName(sessionId), () => Promise.resolve()).catch(() => undefined), timeout]);
  }
  bc?.close();
}
