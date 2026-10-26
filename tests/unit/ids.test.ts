import { afterEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { newId } from '../../apps/web/src/ids';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A crypto without `randomUUID`, as an insecure context (plain HTTP on a LAN address) offers it. */
const insecureCrypto = () => ({ getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });

describe('newId', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses randomUUID when the browser offers it', () => {
    const randomUUID = vi.fn(() => '11111111-2222-4333-8444-555555555555');
    vi.stubGlobal('crypto', { randomUUID, getRandomValues: () => { throw new Error('not expected'); } });
    expect(newId()).toBe('11111111-2222-4333-8444-555555555555');
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it('builds a version 4 UUID from getRandomValues when randomUUID is missing', () => {
    vi.stubGlobal('crypto', insecureCrypto());
    expect('randomUUID' in globalThis.crypto).toBe(false);
    for (let index = 0; index < 50; index += 1) expect(newId()).toMatch(V4);
  });

  it('never repeats an id in the fallback', () => {
    vi.stubGlobal('crypto', insecureCrypto());
    const ids = new Set(Array.from({ length: 1000 }, newId));
    expect(ids.size).toBe(1000);
  });

  it('sets the version and variant bits whatever the random bytes are', () => {
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(0xff) });
    expect(newId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(0) });
    expect(newId()).toBe('00000000-0000-4000-8000-000000000000');
  });
});
