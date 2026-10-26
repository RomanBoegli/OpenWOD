import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve('.cache/ms-playwright');

export default defineConfig({
  testDir: 'tests/production',
  outputDir: 'test-results-production',
  workers: 2,
  reporter: 'list',
  use: { baseURL: process.env.WODVA_PRODUCTION_URL ?? 'http://127.0.0.1:8080', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
