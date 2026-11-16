import { afterEach, describe, expect, it, vi } from 'vitest';
import { bundledWorkout } from '../../packages/domain/src/bundled';
import type { LiveController, LiveSessionItem, LiveSessionPut } from '../../packages/household/src/types';
import type { Checkpoint, Progress } from '../../apps/web/src/data/checkpoints';
import { ApiError, NetworkError } from '../../apps/web/src/data/client';
import { controlledElsewhere, createUplink, handoverNote, KEEPALIVE_BYTES, liveSessions, sessionHeadline, takenOverBy, uplinkBody } from '../../apps/web/src/data/live-sessions';

const DEVICE = { deviceId: 'device-ipad', deviceLabel: 'iPad · home screen' };
const at = (seconds: number) => new Date(Date.parse('2026-11-16T10:00:00.000Z') + seconds * 1000).toISOString();
/** A checkpoint of revision `revision`, saved that many seconds in; the snapshot does not matter to the uplink. */
const checkpointOf = (revision: number, change: Partial<Checkpoint> = {}): Checkpoint => ({ sessionId: 's1', workoutId: 'fran', workoutRevision: 1, workout: bundledWorkout('fran'), snapshot: { revision } as Checkpoint['snapshot'], revision, status: 'running', savedAt: at(revision), ...change });
const progressOf = (checkpointRevision: number, seconds: number): Progress => ({ sessionId: 's1', checkpointRevision, phaseMs: seconds * 1000, activeMs: seconds * 1000, sectionMs: seconds * 1000, savedAt: at(seconds) });
const takenOver = (controller: Partial<LiveController> = { deviceId: 'device-mac', deviceLabel: 'Mac · Safari', generation: 2 }) => new ApiError(409, 'SESSION_TAKEN_OVER', 'This session continues on Mac · Safari.', undefined, { code: 'SESSION_TAKEN_OVER', controller });

/** An uplink over a recorded `send` whose next answers the test queues: nothing queued means success. */
function harness(options: { keepaliveBytes?: number } = {}) {
  const sends: { id: string; body: LiveSessionPut; keepalive: boolean }[] = [];
  const failures: unknown[] = [];
  const controllers: LiveController[] = [];
  const finished: number[] = [];
  const uplink = createUplink({
    ...options, device: () => DEVICE,
    send: async (id, body, { keepalive }) => { sends.push({ id, body, keepalive }); const failure = failures.shift(); if (failure) throw failure; },
    onTakenOver: controller => controllers.push(controller), onFinished: () => finished.push(sends.length),
  });
  /** What each send carried: C3 for a checkpoint of revision 3, P3@12 for a progress record of revision 3 saved at second 12. */
  const carried = () => sends.map(({ body }) => [body.checkpoint ? `C${body.checkpoint.revision}` : '', body.progress ? `P${body.progress.checkpointRevision}@${(Date.parse(body.progress.savedAt) - Date.parse(at(0))) / 1000}` : ''].filter(Boolean).join('+'));
  return { uplink, sends, failures, controllers, finished, carried };
}

describe('live uplink (ENG-15)', () => {
  it('sends the whole checkpoint when its revision is new to the server and the progress record alone otherwise', async () => {
    const { uplink, sends, carried } = harness();
    expect(await uplink.write({ checkpoint: checkpointOf(3) })).toBe('sent');
    expect(sends[0]).toEqual({ id: 's1', body: { ...DEVICE, checkpoint: checkpointOf(3) }, keepalive: false });
    expect(await uplink.write({ checkpoint: checkpointOf(3) })).toBe('current');
    expect(await uplink.write({ checkpoint: checkpointOf(3), progress: progressOf(3, 6) })).toBe('sent');
    expect(sends[1]).toEqual({ id: 's1', body: { ...DEVICE, progress: progressOf(3, 6) }, keepalive: false });
    // The same record again, or an older one, is nothing new.
    expect(await uplink.write({ checkpoint: checkpointOf(3), progress: progressOf(3, 6) })).toBe('current');
    expect(await uplink.write({ checkpoint: checkpointOf(3), progress: progressOf(3, 5) })).toBe('current');
    expect(await uplink.write({ checkpoint: checkpointOf(3), progress: progressOf(3, 9) })).toBe('sent');
    // A new revision goes in full; a record still naming the old one stays behind.
    expect(await uplink.write({ checkpoint: checkpointOf(4), progress: progressOf(3, 11) })).toBe('sent');
    expect(await uplink.write({ checkpoint: checkpointOf(5), progress: progressOf(5, 14) })).toBe('sent');
    expect(await uplink.write({ checkpoint: checkpointOf(5), progress: progressOf(5, 17) })).toBe('sent');
    // Another session (Train again) starts over, whatever its revision.
    expect(await uplink.write({ checkpoint: checkpointOf(5, { sessionId: 's2' }) })).toBe('sent');
    expect(carried()).toEqual(['C3', 'P3@6', 'P3@9', 'C4', 'C5+P5@14', 'P5@17', 'C5']);
    expect(sends.at(-1)?.id).toBe('s2');
    expect(uplink.ended).toBe(false);
  });

  it('decides the body as a pure function of the state and what the server holds', () => {
    const state = { checkpoint: checkpointOf(3), progress: progressOf(3, 6) };
    expect(uplinkBody(state, undefined, DEVICE)).toEqual({ ...DEVICE, checkpoint: checkpointOf(3), progress: progressOf(3, 6) });
    expect(uplinkBody(state, { sessionId: 's1', revision: 2 }, DEVICE)).toEqual({ ...DEVICE, checkpoint: checkpointOf(3), progress: progressOf(3, 6) });
    expect(uplinkBody(state, { sessionId: 's9', revision: 3 }, DEVICE)).toHaveProperty('checkpoint');
    expect(uplinkBody(state, { sessionId: 's1', revision: 3 }, DEVICE)).toEqual({ ...DEVICE, progress: progressOf(3, 6) });
    expect(uplinkBody(state, { sessionId: 's1', revision: 3, progressAt: at(5) }, DEVICE)).toEqual({ ...DEVICE, progress: progressOf(3, 6) });
    expect(uplinkBody(state, { sessionId: 's1', revision: 3, progressAt: at(6) }, DEVICE)).toBeUndefined();
    expect(uplinkBody({ checkpoint: checkpointOf(3) }, { sessionId: 's1', revision: 3 }, DEVICE)).toBeUndefined();
    expect(uplinkBody({ checkpoint: checkpointOf(3), progress: progressOf(2, 6) }, undefined, DEVICE)).toEqual({ ...DEVICE, checkpoint: checkpointOf(3) });
    expect(uplinkBody({ checkpoint: checkpointOf(3), progress: { ...progressOf(3, 6), sessionId: 's2' } }, { sessionId: 's1', revision: 3 }, DEVICE)).toBeUndefined();
    // The note of where an adopted session came from is this device's own: the server's checkpoint shape has no room for it.
    const adopted = checkpointOf(3, { handover: { from: 'Mac · Safari', savedAt: at(2) } });
    expect(uplinkBody({ checkpoint: adopted }, undefined, DEVICE)).toEqual({ ...DEVICE, checkpoint: checkpointOf(3) });
    expect(uplinkBody({ checkpoint: adopted }, undefined, DEVICE)?.checkpoint).not.toHaveProperty('handover');
    expect(adopted.handover).toEqual({ from: 'Mac · Safari', savedAt: at(2) });
  });

  it('sends the checkpoint again after a failed send, and in full again when the server has lost the row', async () => {
    const { uplink, failures, carried } = harness();
    failures.push(new NetworkError());
    await expect(uplink.write({ checkpoint: checkpointOf(3) })).rejects.toBeInstanceOf(NetworkError);
    expect(await uplink.write({ checkpoint: checkpointOf(3), progress: progressOf(3, 6) })).toBe('sent');
    failures.push(new NetworkError('The household server answered 502.'));
    await expect(uplink.write({ checkpoint: checkpointOf(3), progress: progressOf(3, 9) })).rejects.toBeInstanceOf(NetworkError);
    expect(await uplink.write({ checkpoint: checkpointOf(3), progress: progressOf(3, 9) })).toBe('sent');
    expect(carried()).toEqual(['C3', 'C3+P3@6', 'P3@9', 'P3@9']);
    // Discarded on another device or twelve hours old: the progress record meets no row, so the same write sends everything.
    failures.push(new ApiError(404, 'NOT_FOUND', 'Live session "s1" was not found.'));
    expect(await uplink.write({ checkpoint: checkpointOf(3), progress: progressOf(3, 12) })).toBe('sent');
    expect(carried().slice(4)).toEqual(['P3@12', 'C3+P3@12']);
    expect(await uplink.write({ checkpoint: checkpointOf(3), progress: progressOf(3, 12) })).toBe('current');
    // A server without the route answers every checkpoint with 404: that stays a failure to try again, not a loop.
    failures.push(new ApiError(404, 'NOT_FOUND', 'No route for PUT /api/v1/live-sessions/s1.'));
    await expect(uplink.write({ checkpoint: checkpointOf(4) })).rejects.toMatchObject({ status: 404 });
    expect(carried()).toHaveLength(7);
  });

  it('reports a take-over exactly once and sends nothing afterwards', async () => {
    const { uplink, sends, failures, controllers, finished } = harness();
    await uplink.write({ checkpoint: checkpointOf(3) });
    // Two sends in flight when the other device claims: both are refused, one report.
    failures.push(takenOver(), takenOver());
    expect(await Promise.all([uplink.write({ checkpoint: checkpointOf(4) }), uplink.write({ checkpoint: checkpointOf(4), keepalive: true })])).toEqual(['ended', 'ended']);
    expect(controllers).toEqual([{ deviceId: 'device-mac', deviceLabel: 'Mac · Safari', generation: 2 }]);
    expect(uplink.ended).toBe(true);
    expect(await uplink.write({ checkpoint: checkpointOf(5), progress: progressOf(5, 20) })).toBe('ended');
    expect(await uplink.write({ checkpoint: checkpointOf(6), keepalive: true })).toBe('ended');
    expect(sends).toHaveLength(3);
    expect(controllers).toHaveLength(1);
    expect(finished).toEqual([]);
    // Taking the session back starts over with a whole checkpoint.
    uplink.reset();
    expect(uplink.ended).toBe(false);
    expect(await uplink.write({ checkpoint: checkpointOf(3) })).toBe('sent');
    expect(sends.at(-1)?.body).toHaveProperty('checkpoint');
  });

  it('stops quietly when the session is already finished, and names a controller the answer left out', async () => {
    const first = harness();
    first.failures.push(new ApiError(409, 'SESSION_FINISHED', 'This session is already finished.'));
    expect(await first.uplink.write({ checkpoint: checkpointOf(3) })).toBe('ended');
    expect(await first.uplink.write({ checkpoint: checkpointOf(4) })).toBe('ended');
    expect(first.sends).toHaveLength(1);
    expect(first.finished).toEqual([1]);
    expect(first.controllers).toEqual([]);
    const second = harness();
    second.failures.push(new ApiError(409, 'SESSION_TAKEN_OVER', 'Taken over.'));
    expect(await second.uplink.write({ checkpoint: checkpointOf(3) })).toBe('ended');
    expect(second.controllers).toEqual([{ deviceId: '', deviceLabel: 'another device', generation: 0 }]);
    expect(takenOverBy(new ApiError(409, 'REVISION_CONFLICT', 'Another conflict.'))).toBeUndefined();
    expect(takenOverBy(new NetworkError())).toBeUndefined();
  });

  it('skips a keepalive send whose body is over the limit, which then goes the ordinary way', async () => {
    const { uplink, sends } = harness();
    const small = checkpointOf(3);
    const large = checkpointOf(4, { snapshot: { revision: 4, events: Array.from({ length: 600 }, (_, index) => ({ id: `s1:${index}`, sequence: index, type: 'acknowledged', occurrenceId: 'main/round-3/thrusters', activeMs: index * 1000 })) } as unknown as Checkpoint['snapshot'] });
    expect(JSON.stringify(small).length).toBeLessThan(KEEPALIVE_BYTES);
    expect(JSON.stringify(large).length).toBeGreaterThan(KEEPALIVE_BYTES);
    expect(await uplink.write({ checkpoint: small, keepalive: true })).toBe('sent');
    expect(sends[0].keepalive).toBe(true);
    expect(await uplink.write({ checkpoint: large, keepalive: true })).toBe('skipped');
    expect(sends).toHaveLength(1);
    expect(await uplink.write({ checkpoint: large })).toBe('sent');
    expect(sends[1]).toMatchObject({ keepalive: false, body: { checkpoint: { revision: 4 } } });
    // On top of a checkpoint the server holds, the last progress record is small enough to make it out.
    expect(await uplink.write({ checkpoint: large, progress: progressOf(4, 30), keepalive: true })).toBe('sent');
    expect(sends[2]).toMatchObject({ keepalive: true, body: { progress: { checkpointRevision: 4 } } });
    expect(sends[2].body).not.toHaveProperty('checkpoint');
    // The limit counts bytes, not characters.
    const tight = harness({ keepaliveBytes: JSON.stringify({ ...DEVICE, checkpoint: small }).length });
    expect(await tight.uplink.write({ checkpoint: small, keepalive: true })).toBe('skipped');
  });

  it('sends one keepalive request for what hiding and closing the page both ask for', async () => {
    const sends: LiveSessionPut[] = [];
    const gates: (() => void)[] = [];
    const uplink = createUplink({ device: () => DEVICE, onTakenOver: () => undefined, send: (_id, body) => { sends.push(body); return new Promise<void>(resolve => { gates.push(resolve); }); } });
    const hidden = uplink.write({ checkpoint: checkpointOf(3), keepalive: true });
    // The same state again while the first is in flight (visibilitychange, then pagehide) is nothing new.
    expect(await uplink.write({ checkpoint: checkpointOf(3), keepalive: true })).toBe('current');
    // An ordinary send of it still goes: a closing page might not finish that one, so neither stands in for the other.
    const ordinary = uplink.write({ checkpoint: checkpointOf(3) });
    expect(sends).toHaveLength(2);
    gates.forEach(open => open());
    expect(await Promise.all([hidden, ordinary])).toEqual(['sent', 'sent']);
    // The same holds for a progress record on its way out, and once answered the state is simply known.
    const progress = uplink.write({ checkpoint: checkpointOf(3), progress: progressOf(3, 6), keepalive: true });
    expect(await uplink.write({ checkpoint: checkpointOf(3), progress: progressOf(3, 6), keepalive: true })).toBe('current');
    expect(sends).toHaveLength(3);
    expect(sends[2]).toEqual({ ...DEVICE, progress: progressOf(3, 6) });
    gates[2]();
    expect(await progress).toBe('sent');
    expect(await uplink.write({ checkpoint: checkpointOf(3), progress: progressOf(3, 6), keepalive: true })).toBe('current');
    expect(sends).toHaveLength(3);
    // A keepalive send that failed can be asked for again.
    const failing = createUplink({ device: () => DEVICE, onTakenOver: () => undefined, send: () => Promise.reject(new NetworkError()) });
    await expect(failing.write({ checkpoint: checkpointOf(3), keepalive: true })).rejects.toBeInstanceOf(NetworkError);
    await expect(failing.write({ checkpoint: checkpointOf(3), keepalive: true })).rejects.toBeInstanceOf(NetworkError);
  });

  it('does not repeat a checkpoint the server will never take, and never lets an older answer take back a newer one', async () => {
    const { uplink, sends, failures, carried } = harness();
    failures.push(new ApiError(413, 'PAYLOAD_TOO_LARGE', 'The request body is larger than this route accepts.'));
    expect(await uplink.write({ checkpoint: checkpointOf(3) })).toBe('refused');
    expect(await uplink.write({ checkpoint: checkpointOf(3), progress: progressOf(3, 6) })).toBe('refused');
    expect(sends).toHaveLength(1);
    expect(await uplink.write({ checkpoint: checkpointOf(4) })).toBe('sent');

    // A slow send of revision 5 answers after the keepalive send of revision 6 that overtook it.
    const slow = harness();
    const gates: (() => void)[] = [];
    const held = createUplink({ device: () => DEVICE, onTakenOver: () => undefined, send: (id, body, { keepalive }) => { slow.sends.push({ id, body, keepalive }); return keepalive ? Promise.resolve() : new Promise<void>(resolve => { gates.push(resolve); }); } });
    const first = held.write({ checkpoint: checkpointOf(5) });
    expect(await held.write({ checkpoint: checkpointOf(6), keepalive: true })).toBe('sent');
    gates[0]();
    expect(await first).toBe('sent');
    expect(await held.write({ checkpoint: checkpointOf(6) })).toBe('current');
    expect(slow.carried()).toEqual(['C5', 'C6']);
    expect(carried()).toEqual(['C3', 'C4']);
  });
});

describe('live-session calls (ENG-15)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks the browser to keep a send alive only when told to, and reads the controller from a 409', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const answers: Response[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => { calls.push({ url, init }); return answers.shift() ?? new Response(JSON.stringify({ id: 's1', generation: 1, revision: 3, savedAt: at(3) }), { status: 200 }); });
    const body = { ...DEVICE, checkpoint: checkpointOf(3) };
    expect(await liveSessions.put('s 1', body, { keepalive: true })).toEqual({ id: 's1', generation: 1, revision: 3, savedAt: at(3) });
    expect(calls[0]).toMatchObject({ url: '/api/v1/live-sessions/s%201', init: { method: 'PUT', keepalive: true, body: JSON.stringify(body) } });
    await liveSessions.put('s1', body);
    expect(calls[1].init).not.toHaveProperty('keepalive');
    answers.push(new Response(JSON.stringify({ error: { code: 'SESSION_TAKEN_OVER', message: 'This session continues on Mac · Safari.', controller: { deviceId: 'device-mac', deviceLabel: 'Mac · Safari', generation: 2 } } }), { status: 409 }));
    const refused = await liveSessions.put('s1', body).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ApiError);
    expect(takenOverBy(refused)).toEqual({ deviceId: 'device-mac', deviceLabel: 'Mac · Safari', generation: 2 });
    // The claim says who asks; the list and the discard carry no body.
    answers.push(new Response(JSON.stringify({ id: 's1' }), { status: 200 }), new Response(JSON.stringify({ now: at(0), sessions: [] }), { status: 200 }), new Response(null, { status: 204 }));
    await liveSessions.claim('s1');
    expect(calls[3]).toMatchObject({ url: '/api/v1/live-sessions/s1/claim', init: { method: 'POST' } });
    expect(JSON.parse(String(calls[3].init.body))).toEqual({ deviceId: expect.stringMatching(/^[a-z0-9-]{8,80}$/), deviceLabel: 'Device · browser' });
    expect(await liveSessions.list()).toEqual({ now: at(0), sessions: [] });
    expect(await liveSessions.remove('s1')).toBeUndefined();
    expect(calls.slice(4).map(call => [call.init.method, call.url, call.init.body])).toEqual([['GET', '/api/v1/live-sessions', undefined], ['DELETE', '/api/v1/live-sessions/s1', undefined]]);
    // A device ending its own session names itself, so the server leaves the row of a device that has taken it over.
    answers.push(new Response(null, { status: 204 }));
    await liveSessions.remove('s1', { own: true });
    expect(calls[6]).toMatchObject({ url: expect.stringMatching(/^\/api\/v1\/live-sessions\/s1\?deviceId=[a-z0-9-]{8,80}$/), init: { method: 'DELETE' } });
  });

  it('names a session by what its device is doing and notes where an adopted one came from', () => {
    expect(sessionHeadline({ status: 'running', deviceLabel: 'iPad · home screen' })).toBe('Session running on iPad · home screen');
    expect(sessionHeadline({ status: 'preparing', deviceLabel: 'Mac · Safari' })).toBe('Session running on Mac · Safari');
    expect(sessionHeadline({ status: 'awaitingReady', deviceLabel: 'Mac · Safari' })).toBe('Session running on Mac · Safari');
    expect(sessionHeadline({ status: 'paused', deviceLabel: 'iPhone · Safari' })).toBe('Session paused on iPhone · Safari');
    const from: LiveSessionItem = { id: 's1', workoutId: 'fran', title: 'Fran', status: 'running', activeMs: 0, deviceId: 'device-ipad', deviceLabel: 'iPad · home screen', generation: 1, revision: 3, savedAt: at(0), updatedAt: at(100) };
    const now = Date.parse(at(160));
    // The server's clock runs 40 s ahead of this device's: its 100 s is this device's 60 s.
    expect(handoverNote(from, 40_000, 'device-mac', now)).toEqual({ from: 'iPad · home screen', savedAt: at(60) });
    expect(handoverNote(from, -30_000, 'device-mac', now)).toEqual({ from: 'iPad · home screen', savedAt: at(130) });
    // Never in this device's future, and never without a time.
    expect(handoverNote(from, -90_000, 'device-mac', now)).toEqual({ from: 'iPad · home screen', savedAt: at(160) });
    expect(handoverNote({ ...from, updatedAt: 'not a time' }, 0, 'device-mac', now)).toEqual({ from: 'iPad · home screen', savedAt: at(160) });
    // Nothing to note for a session this device controlled already, or one nobody listed.
    expect(handoverNote(from, 0, 'device-ipad', now)).toBeUndefined();
    expect(handoverNote(undefined, 0, 'device-mac', now)).toBeUndefined();
  });

  it("offers the sessions other devices control and leaves out this device's own", () => {
    const item = (id: string, deviceId: string): LiveSessionItem => ({ id, workoutId: 'fran', title: 'Fran', status: 'running', activeMs: 0, deviceId, deviceLabel: 'iPad · home screen', generation: 1, revision: 1, savedAt: at(0), updatedAt: at(0) });
    const sessions = [item('s1', 'device-ipad'), item('s2', 'device-mac'), item('s3', 'device-phone')];
    expect(controlledElsewhere(sessions, 'device-mac').map(entry => entry.id)).toEqual(['s1', 's3']);
    expect(controlledElsewhere(sessions, 'device-watch')).toHaveLength(3);
    expect(controlledElsewhere([], 'device-mac')).toEqual([]);
  });
});
