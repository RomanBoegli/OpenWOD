import { expect, it } from 'vitest';
import { createServer } from '../../apps/server/src/app';

it('exposes health and structured API errors without claiming database persistence', async () => {
  const server = await createServer({ webRoot: '/does-not-exist' });
  try {
    expect((await server.inject('/api/v1/health/live')).json()).toMatchObject({ status: 'ok' });
    expect((await server.inject('/api/v1/health/ready')).json()).toMatchObject({ persistence: false });
    const missing = await server.inject('/api/v1/missing');
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  } finally { await server.close(); }
});
