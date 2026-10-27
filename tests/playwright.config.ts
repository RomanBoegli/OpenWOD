import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(import.meta.dirname, '../.cache/ms-playwright');

const STATIC_URL = 'http://127.0.0.1:5175';
const STATIC_SPECS = ['static/**/*.spec.ts', 'player.spec.ts', 'editor.spec.ts', 'settings.spec.ts', 'screens.spec.ts', 'tabs.spec.ts', 'library.spec.ts', 'recovery.spec.ts'];

export default defineConfig({
  testDir: './e2e',
  outputDir: '../test-results',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 3 : 2,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5174', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', testIgnore: 'static/**', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', testIgnore: 'static/**', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', testIgnore: 'static/**', use: { ...devices['Desktop Safari'] } },
    // The static shape: the library in the browser's IndexedDB, no API. Its own specs plus the shared ones that never call the server.
    { name: 'static-chromium', testMatch: STATIC_SPECS, use: { ...devices['Desktop Chrome'], baseURL: STATIC_URL } },
    { name: 'static-firefox', testMatch: STATIC_SPECS, use: { ...devices['Desktop Firefox'], baseURL: STATIC_URL } },
    { name: 'static-webkit', testMatch: STATIC_SPECS, use: { ...devices['Desktop Safari'], baseURL: STATIC_URL } },
  ],
  // Three processes: the API with one in-memory database per test scope, Vite proxying /api to it, and the static-test build on its own port.
  webServer: [
    { command: 'npx tsx apps/server/src/index.ts', cwd: resolve(import.meta.dirname, '..'), url: 'http://127.0.0.1:8787/api/v1/health/ready', reuseExistingServer: !process.env.CI, env: { PORT: '8787', HOST: '127.0.0.1', DATABASE_PATH: ':memory:', OPENWOD_TEST_SCOPES: '1', LOG_LEVEL: 'warn' } },
    { command: 'npm run dev -- --mode test --port 5174', url: 'http://127.0.0.1:5174', reuseExistingServer: !process.env.CI },
    { command: 'npm run dev -- --mode static-test --port 5175', url: STATIC_URL, reuseExistingServer: !process.env.CI },
  ],
});
