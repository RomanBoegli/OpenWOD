import { test as base, expect, type TestInfo } from '@playwright/test';

/**
 * Every browser test gets its own household: the test build sends an X-OpenWOD-Scope header with each API call and
 * the test server keeps one in-memory database per scope, so parallel workers never see each other's data and a
 * reload within a test keeps its own. The `api` helper talks to the same scope for seeding and assertions. The static
 * projects need none of this: every test gets a fresh browser context, so its own IndexedDB library.
 */
export const API = 'http://127.0.0.1:8787';

export interface Api {
  scope: string;
  get: <T = unknown>(path: string) => Promise<T>;
  put: <T = unknown>(path: string, body: unknown, ifMatch?: number) => Promise<{ status: number; body: T }>;
  post: <T = unknown>(path: string, body: unknown) => Promise<{ status: number; body: T }>;
}

const scopeOf = (testInfo: TestInfo) => `w${testInfo.workerIndex}-${testInfo.testId.replace(/[^A-Za-z0-9_-]/g, '')}-r${testInfo.retry}`.slice(0, 64);

/** The static projects run the static-test build: the library lives in the browser and there is no API to call. */
export const isStaticProject = (testInfo: TestInfo = base.info()) => testInfo.project.name.startsWith('static-');

/** A client for this test's household on the test server. Static projects have none, and asking for one says so. */
export function apiFor(testInfo: TestInfo = base.info()): Api {
  if (isStaticProject(testInfo)) throw new Error(`The api fixture talks to the household server, which static project "${testInfo.project.name}" does not run. Mark the test serverOnly() or assert through the page.`);
  const scope = scopeOf(testInfo);
  const headers = { 'content-type': 'application/json', 'x-openwod-scope': scope };
  const call = async <T,>(method: string, path: string, body?: unknown, ifMatch?: number) => {
    const response = await fetch(`${API}${path}`, { method, headers: { ...headers, ...(ifMatch === undefined ? {} : { 'if-match': `"${ifMatch}"` }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : undefined) as T };
  };
  return {
    scope,
    get: async path => (await call('GET', path)).body as never,
    put: (path, body, ifMatch) => call('PUT', path, body, ifMatch),
    post: (path, body) => call('POST', path, body),
  };
}

export const test = base.extend<{ api: Api; staticProject: boolean }>({
  context: async ({ context }, use, testInfo) => {
    if (!isStaticProject(testInfo)) await context.addInitScript(value => { window.__openwodScope = value; }, scopeOf(testInfo));
    await use(context);
  },
  api: async ({}, use, testInfo) => { await use(apiFor(testInfo)); },
  staticProject: async ({}, use, testInfo) => { await use(isStaticProject(testInfo)); },
});

/**
 * Skips the tests of the surrounding describe block (or file) in the static projects: call it at describe or file
 * level, before tests that need the household server, so the skip happens before the api fixture is set up.
 */
export const serverOnly = () => test.skip(({ staticProject }) => staticProject, 'Needs the household server.');

export { expect };
