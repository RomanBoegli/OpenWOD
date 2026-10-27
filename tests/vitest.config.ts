import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8')) as { version: string; homepage: string };

// The config lives under tests/; the project root is one level up, resolved absolutely so cwd does not matter.
// The build constants match the server shape of vite.config.ts; a test that needs the static shape builds its backend directly.
export default defineConfig({
  root: resolve(import.meta.dirname, '..'),
  define: { __OPENWOD_TEST__: 'false', __OPENWOD_STATIC__: 'false', __OPENWOD_VERSION__: JSON.stringify(pkg.version), __OPENWOD_REPO__: JSON.stringify(pkg.homepage) },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
});
