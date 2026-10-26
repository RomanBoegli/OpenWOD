import { test as base, expect } from '@playwright/test';

/**
 * Every browser test gets its own household: the test build sends an X-OpenWOD-Scope header with each API call and
 * the test server keeps one in-memory database per scope, so parallel workers never see each other's data and a
 * reload within a test keeps its own. The `api` helper talks to the same scope for seeding and assertions.
 */
export const API = 'http://127.0.0.1:8787';

export interface Api {
  scope: string;
  get: <T = unknown>(path: string) => Promise<T>;
  put: <T = unknown>(path: string, body: unknown, ifMatch?: number) => Promise<{ status: number; body: T }>;
  post: <T = unknown>(path: string, body: unknown) => Promise<{ status: number; body: T }>;
}

export const test = base.extend<{ api: Api }>({
  context: async ({ context }, use, testInfo) => {
    const scope = `w${testInfo.workerIndex}-${testInfo.testId.replace(/[^A-Za-z0-9_-]/g, '')}-r${testInfo.retry}`.slice(0, 64);
    await context.addInitScript(value => { window.__openwodScope = value; }, scope);
    await use(context);
  },
  api: async ({}, use, testInfo) => {
    const scope = `w${testInfo.workerIndex}-${testInfo.testId.replace(/[^A-Za-z0-9_-]/g, '')}-r${testInfo.retry}`.slice(0, 64);
    const headers = { 'content-type': 'application/json', 'x-openwod-scope': scope };
    const call = async <T,>(method: string, path: string, body?: unknown, ifMatch?: number) => {
      const response = await fetch(`${API}${path}`, { method, headers: { ...headers, ...(ifMatch === undefined ? {} : { 'if-match': `"${ifMatch}"` }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const text = await response.text();
      return { status: response.status, body: (text ? JSON.parse(text) : undefined) as T };
    };
    await use({
      scope,
      get: async path => (await call('GET', path)).body as never,
      put: (path, body, ifMatch) => call('PUT', path, body, ifMatch),
      post: (path, body) => call('POST', path, body),
    });
  },
});

export { expect };
