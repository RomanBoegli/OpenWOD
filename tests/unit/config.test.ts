import { describe, expect, it } from 'vitest';
import { readConfig } from '../../apps/server/src/config';

describe('server configuration', () => {
  it('applies documented defaults and parses every variable', () => {
    expect(readConfig({})).toEqual({ port: 8080, host: '0.0.0.0', databasePath: '/data/app.sqlite', logLevel: 'info', trustProxy: false, testScopes: false });
    expect(readConfig({ PORT: '8787', HOST: '127.0.0.1', WEB_ROOT: '/srv/web', DATABASE_PATH: ':memory:', LOG_LEVEL: 'DEBUG', TRUST_PROXY: 'true', OPENWOD_TEST_SCOPES: '1' })).toEqual({ port: 8787, host: '127.0.0.1', webRoot: '/srv/web', databasePath: ':memory:', logLevel: 'debug', trustProxy: true, testScopes: true });
    expect(readConfig({ TRUST_PROXY: '10.0.0.1, 10.0.0.2' }).trustProxy).toBe('10.0.0.1, 10.0.0.2');
  });

  it('rejects values it cannot use', () => {
    expect(() => readConfig({ PORT: '70000' })).toThrow(/PORT/);
    expect(() => readConfig({ LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/);
    expect(() => readConfig({ DATABASE_PATH: '  ' })).toThrow(/DATABASE_PATH/);
  });
});
