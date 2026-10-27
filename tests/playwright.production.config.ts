import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(import.meta.dirname, '../.cache/ms-playwright');

// A trailing slash, so the specs' relative URLs (./, ./cues/…) stay under a prefix such as /openwod/ on a static host.
const baseURL = (process.env.OPENWOD_PRODUCTION_URL ?? 'http://127.0.0.1:8080').replace(/\/*$/, '/');

export default defineConfig({
  testDir: './production',
  outputDir: '../test-results-production',
  workers: 2,
  reporter: 'list',
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
