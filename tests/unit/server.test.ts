import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { get } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { bundledWorkout } from '../../packages/domain/src/bundled';
import { emptyMasterData } from '../../packages/domain/src/master-data';
import type { Workout } from '../../packages/domain/src/schema';
import { createServer } from '../../apps/server/src/app';
import { Store } from '../../apps/server/src/store';
import { playedSession } from './helpers/session';

const scratch = mkdtempSync(join(tmpdir(), 'openwod-server-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const HAS_OPENSSL = spawnSync('openssl', ['version'], { stdio: 'ignore' }).status === 0;
const own = (id: string, revision = 1): Workout => ({ ...bundledWorkout('fran'), id, revision, title: `Own ${id}`, sharing: undefined });

describe('server', () => {
  it('answers health without a store and refuses data routes until one exists', async () => {
    const server = await createServer({ webRoot: '/does-not-exist', version: '9.9.9' });
    try {
      expect((await server.inject('/api/v1/health/live')).json()).toEqual({ status: 'ok', version: '9.9.9' });
      const ready = await server.inject('/api/v1/health/ready');
      expect(ready.statusCode).toBe(503);
      expect(ready.json()).toMatchObject({ persistence: false });
      expect((await server.inject('/api/v1/workouts')).statusCode).toBe(503);
      const missing = await server.inject('/api/v1/missing');
      expect(missing.statusCode).toBe(404);
      expect(missing.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    } finally { await server.close(); }
  });

  it.skipIf(!HAS_OPENSSL)('listens on HTTPS itself when given a key and a certificate', async () => {
    const keyPath = join(scratch, 'key.pem');
    const certPath = join(scratch, 'cert.pem');
    expect(spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath, '-days', '2', '-subj', '/CN=localhost'], { stdio: 'ignore' }).status).toBe(0);
    const server = await createServer({ webRoot: '/does-not-exist', version: '9.9.9', https: { key: readFileSync(keyPath, 'utf8'), cert: readFileSync(certPath, 'utf8') } });
    try {
      const address = await server.listen({ host: '127.0.0.1', port: 0 });
      expect(address).toMatch(/^https:\/\//);
      const live = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        get(`${address}/api/v1/health/live`, { rejectUnauthorized: false }, response => {
          let body = '';
          response.on('data', chunk => { body += chunk; });
          response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
        }).on('error', reject);
      });
      expect(live.status).toBe(200);
      expect(JSON.parse(live.body)).toEqual({ status: 'ok', version: '9.9.9' });
    } finally { await server.close(); }
  });

  it('shares the settings across the household and bounds them', async () => {
    const { store } = await Store.open(':memory:');
    const server = await createServer({ webRoot: '/does-not-exist', store });
    const put = (payload: unknown) => server.inject({ method: 'PUT', url: '/api/v1/settings', payload: payload as object });
    try {
      expect((await server.inject('/api/v1/settings')).json()).toEqual({ revision: 0 });
      expect((await put({ document: { theme: 'dark', names: { A: 'Sam', B: 'Kim' } } })).json()).toMatchObject({ revision: 1 });
      expect((await server.inject('/api/v1/settings')).json()).toMatchObject({ revision: 1, document: { theme: 'dark', names: { A: 'Sam' } } });
      expect((await put({ document: [] })).statusCode).toBe(400);
      expect((await put({ theme: 'dark' })).statusCode).toBe(400);
      expect((await put({ document: { notes: 'x'.repeat(70_000) } })).statusCode).toBe(413);
      expect((await server.inject('/api/v1/settings')).json()).toMatchObject({ revision: 1 });
    } finally { await server.close(); store.close(); }
  });

  it('serves the household API with revision checks, structured errors and idempotent sessions', async () => {
    const { store } = await Store.open(':memory:');
    const server = await createServer({ webRoot: '/does-not-exist', store });
    const put = (path: string, payload: object, ifMatch?: number) => server.inject({ method: 'PUT', url: path, payload, headers: ifMatch === undefined ? {} : { 'if-match': `"${ifMatch}"` } });
    try {
      expect((await server.inject('/api/v1/health/ready')).json()).toMatchObject({ persistence: true, schemaVersion: 2 });
      // Workouts
      expect((await put('/api/v1/workouts/a', { document: own('a') })).statusCode).toBe(201);
      expect((await put('/api/v1/workouts/a', { document: own('a', 2) })).statusCode).toBe(409);
      const conflict = await put('/api/v1/workouts/a', { document: own('a', 2) }, 5);
      expect(conflict.statusCode).toBe(409);
      expect(conflict.json()).toMatchObject({ error: { code: 'REVISION_CONFLICT', current: { revision: 1 } } });
      expect(conflict.json().error.current.document.id).toBe('a');
      expect((await put('/api/v1/workouts/a', { document: own('a', 2) }, 1)).statusCode).toBe(200);
      expect((await put('/api/v1/workouts/b', { document: own('a', 3) }, 2)).json()).toMatchObject({ error: { code: 'ID_MISMATCH' } });
      expect((await put('/api/v1/workouts/c', { document: { nonsense: true } })).json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
      expect((await server.inject({ method: 'PUT', url: '/api/v1/workouts/c', payload: { document: own('c') }, headers: { 'if-match': 'abc' } })).json()).toMatchObject({ error: { code: 'BAD_IF_MATCH' } });
      expect((await server.inject({ method: 'PUT', url: '/api/v1/workouts/c', payload: '{not json', headers: { 'content-type': 'application/json' } })).json()).toMatchObject({ error: { code: 'BAD_JSON' } });
      const huge = await server.inject({ method: 'PUT', url: '/api/v1/workouts/c', payload: { document: { ...own('c'), description: 'x'.repeat(1_100_000) } } });
      expect(huge.statusCode).toBe(413);
      expect((await server.inject('/api/v1/workouts')).json().workouts.map((item: { id: string; revision: number }) => [item.id, item.revision])).toEqual([['a', 2]]);
      expect((await server.inject('/api/v1/workouts/zzz')).statusCode).toBe(404);
      expect((await server.inject({ method: 'DELETE', url: '/api/v1/workouts/a', headers: { 'if-match': '"1"' } })).statusCode).toBe(409);
      expect((await server.inject({ method: 'DELETE', url: '/api/v1/workouts/a', headers: { 'if-match': '"2"' } })).statusCode).toBe(204);
      expect((await server.inject('/api/v1/workouts')).json().workouts).toEqual([]);
      expect((await server.inject('/api/v1/workouts?includeArchived=1')).json().workouts).toHaveLength(1);
      // Master data
      expect((await server.inject('/api/v1/master-data')).json()).toEqual({ revision: 0, document: emptyMasterData() });
      expect((await put('/api/v1/master-data', { document: { ...emptyMasterData(), hiddenMovements: ['thruster'] } })).json()).toMatchObject({ revision: 1 });
      expect((await put('/api/v1/master-data', { document: emptyMasterData() })).statusCode).toBe(409);
      expect((await put('/api/v1/master-data', { document: { ...emptyMasterData(), extra: 1 } }, 1)).statusCode).toBe(400);
      // Sessions
      const session = playedSession('s1', bundledWorkout('fran'));
      expect((await put('/api/v1/sessions/s1', session)).statusCode).toBe(201);
      expect((await put('/api/v1/sessions/s1', session)).json()).toEqual({ id: 's1', stored: 'existing' });
      expect((await put('/api/v1/sessions/s2', { ...session, id: 's2', workout: undefined })).json()).toMatchObject({ error: { code: 'VALIDATION_FAILED', path: '/workout' } });
      expect((await server.inject('/api/v1/sessions')).json().sessions).toHaveLength(1);
      expect((await server.inject('/api/v1/sessions/s1')).json().workout.id).toBe('fran');
      const patch = await server.inject({ method: 'PATCH', url: '/api/v1/sessions/s1/results', payload: { results: session.results, note: 'same' }, headers: { 'if-match': '"1"' } });
      expect(patch.json()).toEqual({ revision: 2 });
      expect((await server.inject('/api/v1/sessions/s1')).json().corrections).toHaveLength(1);
      // Export and backup
      const exported = await server.inject('/api/v1/export');
      expect(exported.headers['content-disposition']).toContain('openwod-export-');
      expect(exported.json()).toMatchObject({ format: 'openwod.export', formatVersion: 1, schemaVersion: 2 });
      const backup = await server.inject('/api/v1/backup');
      expect(backup.statusCode).toBe(200);
      expect(backup.headers['content-type']).toContain('application/vnd.sqlite3');
      const file = join(scratch, 'downloaded.sqlite');
      writeFileSync(file, backup.rawPayload);
      const copy = new DatabaseSync(file);
      expect((copy.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n).toBe(1);
      copy.close();
    } finally { await server.close(); store.close(); }
  });

  it('restores a JSON export over the household, refusing an invalid or newer one (DAT-11)', async () => {
    const { store: source } = await Store.open(':memory:');
    const { store: target } = await Store.open(join(scratch, 'restore', 'app.sqlite'));
    const from = await createServer({ webRoot: '/does-not-exist', store: source });
    const to = await createServer({ webRoot: '/does-not-exist', store: target });
    const restore = (payload: unknown) => to.inject({ method: 'POST', url: '/api/v1/import/restore', payload: payload as object });
    try {
      await from.inject({ method: 'PUT', url: '/api/v1/workouts/a', payload: { document: own('a') } });
      await from.inject({ method: 'PUT', url: '/api/v1/sessions/s1', payload: playedSession('s1', bundledWorkout('fran')) });
      await from.inject({ method: 'PATCH', url: '/api/v1/sessions/s1/results', payload: { results: playedSession('s1', bundledWorkout('fran')).results, note: 'same' }, headers: { 'if-match': '"1"' } });
      await to.inject({ method: 'PUT', url: '/api/v1/workouts/b', payload: { document: own('b') } });
      const exported = (await from.inject('/api/v1/export')).json();
      const invalid = await restore({ ...exported, workouts: [{ ...exported.workouts[0], document: { nonsense: true } }] });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED', path: expect.stringMatching(/^\/workouts\/0\/document/) } });
      const newer = await restore({ ...exported, formatVersion: 2 });
      expect(newer.statusCode).toBe(400);
      expect(newer.json()).toMatchObject({ error: { code: 'FORMAT_NEWER' } });
      expect((await to.inject('/api/v1/workouts')).json().workouts.map((item: { id: string }) => item.id)).toEqual(['b']);
      const restored = await restore(exported);
      expect(restored.statusCode).toBe(200);
      expect(restored.json()).toMatchObject({ workouts: 1, archived: 0, sessions: 1, corrections: 1, masterRevision: 0, exportedAt: exported.exportedAt, backup: expect.stringMatching(/^pre-restore-.+\.sqlite$/) });
      expect((await to.inject('/api/v1/workouts')).json().workouts.map((item: { id: string }) => item.id)).toEqual(['a']);
      expect((await to.inject('/api/v1/sessions/s1')).json()).toEqual((await from.inject('/api/v1/sessions/s1')).json());
      const { exportedAt: _a, ...again } = (await to.inject('/api/v1/export')).json();
      const { exportedAt: _b, ...original } = exported;
      expect(again).toEqual(original);
    } finally { await from.close(); await to.close(); source.close(); target.close(); }
  });

  it('isolates test scopes behind the header only when enabled', async () => {
    const { store } = await Store.open(':memory:');
    const scoped = await createServer({ webRoot: '/does-not-exist', store, scopes: true });
    const plain = await createServer({ webRoot: '/does-not-exist', store });
    try {
      await scoped.inject({ method: 'PUT', url: '/api/v1/workouts/a', payload: { document: own('a') }, headers: { 'x-openwod-scope': 'one' } });
      expect((await scoped.inject({ url: '/api/v1/workouts', headers: { 'x-openwod-scope': 'one' } })).json().workouts).toHaveLength(1);
      expect((await scoped.inject({ url: '/api/v1/workouts', headers: { 'x-openwod-scope': 'two' } })).json().workouts).toHaveLength(0);
      expect((await scoped.inject('/api/v1/workouts')).json().workouts).toHaveLength(0);
      await plain.inject({ method: 'PUT', url: '/api/v1/workouts/b', payload: { document: own('b') }, headers: { 'x-openwod-scope': 'one' } });
      expect((await plain.inject('/api/v1/workouts')).json().workouts.map((item: { id: string }) => item.id)).toEqual(['b']);
    } finally { await scoped.close(); await plain.close(); store.close(); }
  });
});
