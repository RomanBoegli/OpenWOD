import type { LiveController, LiveSession, LiveSessionAck, LiveSessionClaim, LiveSessionItem, LiveSessionList, LiveSessionPut } from '../../../../packages/household/src/types';
import { WriteQueue, type Checkpoint, type Progress } from './checkpoints';
import { ApiError, request } from './client';
import { deviceId, deviceLabel } from './device';
import { DATA_MODE } from './mode';

/**
 * Hand-over between devices (ENG-15): the device running a session sends its checkpoints and progress records to the
 * household server, and another device claims them to continue. Like the settings (shared-preferences.ts) this talks
 * to the server directly and is not part of the Backend interface: the static shape has no household to hand over
 * through, so there every call fails without a request and the uplink does nothing. The session is always safe on
 * its own device first (checkpoints.ts); nothing here is awaited by the clock.
 */
export type { LiveController, LiveSessionItem } from '../../../../packages/household/src/types';

export const HANDOVER = DATA_MODE === 'server';

const path = (id: string) => `/live-sessions/${encodeURIComponent(id)}`;
const here = (): LiveSessionClaim => ({ deviceId: deviceId(), deviceLabel: deviceLabel() });
const call = <T,>(...args: Parameters<typeof request>): Promise<T> => HANDOVER ? request<T>(...args) : Promise.reject(new ApiError(404, 'NOT_FOUND', 'Hand-over needs the household server.'));

/** Typed calls for the live-session routes (apps/server/src/routes.ts). */
export const liveSessions = {
  /** Every live session of the household without its bodies, this device's own included, with the server's clock. */
  list: () => call<LiveSessionList>('GET', '/live-sessions', { timeoutMs: 6000 }),
  get: (id: string) => call<LiveSession>('GET', path(id)),
  /** Accepted from the controlling device only: 409 SESSION_TAKEN_OVER or SESSION_FINISHED otherwise, 404 for a progress record without a row. */
  put: (id: string, body: LiveSessionPut, { keepalive = false }: { keepalive?: boolean } = {}) => call<LiveSessionAck>('PUT', path(id), { body, keepalive }),
  /** Makes this device the controller and returns the checkpoint and progress to continue from. */
  claim: (id: string) => call<LiveSession>('POST', `${path(id)}/claim`, { body: here() }),
  /** Discards the live session for every device. Idempotent. With `own` it goes only while this device controls it. */
  remove: (id: string, { own = false }: { own?: boolean } = {}) => call<void>('DELETE', `${path(id)}${own ? `?deviceId=${encodeURIComponent(deviceId())}` : ''}`),
};

/** Who controls the session now, read from a SESSION_TAKEN_OVER answer; undefined for any other failure. */
export function takenOverBy(error: unknown): LiveController | undefined {
  if (!(error instanceof ApiError) || error.status !== 409 || error.code !== 'SESSION_TAKEN_OVER') return undefined;
  const controller = (error.payload?.controller ?? {}) as Partial<LiveController>;
  return { deviceId: typeof controller.deviceId === 'string' ? controller.deviceId : '', deviceLabel: typeof controller.deviceLabel === 'string' && controller.deviceLabel ? controller.deviceLabel : 'another device', generation: typeof controller.generation === 'number' ? controller.generation : 0 };
}

/**
 * The note an adopted checkpoint carries (checkpoints.ts `handover`): the device the session comes from and when that
 * device last wrote, moved from the server's clock to this device's (`clockOffsetMs` is the server's minus this one's).
 * None for a session this device already controlled.
 */
export function handoverNote(from: LiveSessionItem | undefined, clockOffsetMs: number, self: string = deviceId(), now: number = Date.now()): Checkpoint['handover'] {
  if (!from || from.deviceId === self) return undefined;
  const written = Date.parse(from.updatedAt) - clockOffsetMs;
  return { from: from.deviceLabel, savedAt: new Date(Number.isFinite(written) ? Math.min(written, now) : now).toISOString() };
}

/** How the app names a session another device runs: "Session running on iPad · home screen", or paused when its clock stands. */
export const sessionHeadline = (session: Pick<LiveSessionItem, 'status' | 'deviceLabel'>): string => `Session ${session.status === 'paused' ? 'paused' : 'running'} on ${session.deviceLabel}`;

/** The sessions another device controls: what this device may offer to continue. Its own session is its player's business. */
export const controlledElsewhere = (sessions: LiveSessionItem[], self: string = deviceId()): LiveSessionItem[] => sessions.filter(item => item.deviceId !== self);

// ---- Uplink ------------------------------------------------------------------------------------------------

/** A running session as its device holds it: the last checkpoint and, if any, the progress record on top of it. */
export interface UplinkState {
  checkpoint: Checkpoint;
  progress?: Progress;
  /** A last send while the page is hidden or closing: the browser finishes it without the page. */
  keepalive?: boolean;
}
/** What the server is known to hold: a checkpoint revision and the time of the progress record on top of it. */
export interface UplinkSent { sessionId: string; revision: number; progressAt?: string }
/** `sent` reached the server, `current` means it had everything already, `skipped` was too large for a keepalive send, `refused` is a checkpoint the server will not take, `ended` follows a take-over or a finished session. */
export type UplinkResult = 'sent' | 'current' | 'skipped' | 'refused' | 'ended';
/** Browsers refuse keepalive requests beyond 64 KiB in all; this leaves room for the headers. */
export const KEEPALIVE_BYTES = 60_000;

/**
 * Decides what one send carries: the whole checkpoint when the server does not hold this revision of it, otherwise
 * only a progress record newer than the one it has, and nothing when it has both. A progress record travels only with
 * the checkpoint it names. The checkpoint's `handover` note is this device's own and stays here.
 */
export function uplinkBody({ checkpoint: { handover: _handover, ...checkpoint }, progress }: UplinkState, sent: UplinkSent | undefined, device: LiveSessionClaim): LiveSessionPut | undefined {
  const extending = progress && progress.sessionId === checkpoint.sessionId && progress.checkpointRevision === checkpoint.revision ? progress : undefined;
  if (!sent || sent.sessionId !== checkpoint.sessionId || sent.revision !== checkpoint.revision) return { ...device, checkpoint, ...(extending ? { progress: extending } : {}) };
  return extending && (!sent.progressAt || extending.savedAt > sent.progressAt) ? { ...device, progress: extending } : undefined;
}

export interface UplinkOptions {
  send: (sessionId: string, body: LiveSessionPut, options: { keepalive: boolean }) => Promise<unknown>;
  /** Read for every send: the label follows the display mode. */
  device: () => LiveSessionClaim;
  /** Called once, when the server answers that another device controls the session. Nothing is sent after it. */
  onTakenOver: (controller: LiveController) => void;
  /** Called once, when the server answers that the session is already finished or deleted. Nothing is sent after it. */
  onFinished?: () => void;
  keepaliveBytes?: number;
}
export interface Uplink {
  /** Sends what the server lacks of `state`. Rejects when the send failed and may work later (offline, a server error): the next call sends it again. */
  write: (state: UplinkState) => Promise<UplinkResult>;
  /** True after a take-over or a finished session: this device has nothing more to send. */
  readonly ended: boolean;
  /** Starts over, for a device that took its session back. */
  reset: () => void;
}

/**
 * The sending side of a hand-over, without a queue or a timer: it remembers what the server holds and sends the
 * difference. Sends may overlap (a keepalive one does not wait for the one in flight), so an older answer never
 * takes back what a newer one established.
 */
export function createUplink({ send, device, onTakenOver, onFinished, keepaliveBytes = KEEPALIVE_BYTES }: UplinkOptions): Uplink {
  let sent: UplinkSent | undefined;
  let refused: { sessionId: string; revision: number } | undefined;
  let ended = false;
  /** The keepalive sends in flight, by what they carry: hiding and closing a page ask for the same one twice. */
  const leaving = new Set<string>();
  const write = async (state: UplinkState): Promise<UplinkResult> => {
    if (ended) return 'ended';
    const { sessionId, revision } = state.checkpoint;
    const body = uplinkBody(state, sent, device());
    if (!body) return 'current';
    if (body.checkpoint && refused?.sessionId === sessionId && refused.revision === revision) return 'refused';
    if (state.keepalive && new TextEncoder().encode(JSON.stringify(body)).length > keepaliveBytes) return 'skipped';
    const carried = `${sessionId}/${body.checkpoint ? revision : ''}/${body.progress?.savedAt ?? ''}`;
    if (state.keepalive && leaving.has(carried)) return 'current';
    if (state.keepalive) leaving.add(carried);
    try {
      await send(sessionId, body, { keepalive: state.keepalive === true });
    } catch (error) {
      leaving.delete(carried);
      if (ended) return 'ended';
      const controller = takenOverBy(error);
      if (controller) { ended = true; onTakenOver(controller); return 'ended'; }
      if (error instanceof ApiError && error.status === 409 && error.code === 'SESSION_FINISHED') { ended = true; onFinished?.(); return 'ended'; }
      // The row is gone (discarded on another device, or 12 hours old): the checkpoint goes again in full.
      if (error instanceof ApiError && error.status === 404 && !body.checkpoint) { sent = undefined; return write(state); }
      // A checkpoint the server will never take (invalid, too large) is not sent every few seconds; the next revision tries again.
      if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 404 && body.checkpoint) { refused = { sessionId, revision }; return 'refused'; }
      throw error;
    }
    leaving.delete(carried);
    const progressAt = body.progress?.savedAt;
    if (!sent || sent.sessionId !== sessionId || revision > sent.revision || (body.checkpoint && revision === sent.revision)) sent = { sessionId, revision, ...(progressAt ? { progressAt } : {}) };
    else if (revision === sent.revision && progressAt && (!sent.progressAt || progressAt > sent.progressAt)) sent = { ...sent, progressAt };
    return 'sent';
  };
  return { write, get ended() { return ended; }, reset() { sent = undefined; refused = undefined; ended = false; leaving.clear(); } };
}

export interface LiveUplink {
  /** Offers the newest state. Only the latest waits behind the send in flight; with `keepalive` it goes at once. */
  push: (state: UplinkState) => void;
  /** Resolves when nothing is waiting or in flight any more (keepalive sends apart). */
  flush: () => Promise<void>;
  /**
   * The session ended on this device. Nothing more is sent, and once what was on its way has settled its live row is
   * removed while this device still controls it, so no other device goes on offering a session that is over. A session
   * that ends with a record loses its row to the upload as well; one too short to count has only this.
   */
  end: (sessionId: string) => void;
  reset: () => void;
}

/**
 * The uplink of one player, ready to use: every checkpoint and the occasional progress record go through `push`, and
 * a push with `keepalive` on hide and pagehide. Failures are silent and never the player's storage warning: the
 * session is safe on this device, and the next push sends again. In the static shape it does nothing.
 */
export function liveUplink(handlers: Pick<UplinkOptions, 'onTakenOver' | 'onFinished'>): LiveUplink {
  if (!HANDOVER) return { push: () => undefined, flush: () => Promise.resolve(), end: () => undefined, reset: () => undefined };
  let over = false;
  // An answer that arrives after the session ended here is no news: the player is on its finish screen.
  const uplink = createUplink({ device: here, send: (id, body, options) => liveSessions.put(id, body, options), onTakenOver: controller => { if (!over) handlers.onTakenOver(controller); }, onFinished: () => { if (!over) handlers.onFinished?.(); } });
  const queue = new WriteQueue<UplinkState>(state => uplink.write(state).then(() => undefined), () => undefined);
  return {
    push(state) {
      if (over) return;
      if (!state.keepalive) { queue.push(state); return; }
      // Too large for a keepalive send: it takes the ordinary way, which a closing page may not finish.
      void uplink.write(state).then(result => { if (result === 'skipped' && !over) queue.push({ ...state, keepalive: false }); }, () => undefined);
    },
    flush: () => queue.flush(),
    end(sessionId) {
      if (over) return;
      over = true;
      void queue.flush().then(() => uplink.ended ? undefined : liveSessions.remove(sessionId, { own: true })).catch(() => undefined);
    },
    reset() { over = false; uplink.reset(); },
  };
}
