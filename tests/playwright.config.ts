import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(import.meta.dirname, '../.cache/ms-playwright');

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
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  // Two processes: the API with one in-memory database per test scope, and Vite proxying /api to it.
  webServer: [
    { command: 'npx tsx apps/server/src/index.ts', cwd: resolve(import.meta.dirname, '..'), url: 'http://127.0.0.1:8787/api/v1/health/ready', reuseExistingServer: !process.env.CI, env: { PORT: '8787', HOST: '127.0.0.1', DATABASE_PATH: ':memory:', OPENWOD_TEST_SCOPES: '1', LOG_LEVEL: 'warn' } },
    { command: 'npm run dev -- --mode test --port 5174', url: 'http://127.0.0.1:5174', reuseExistingServer: !process.env.CI },
  ],
});
