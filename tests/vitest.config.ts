import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// The config lives under tests/; the project root is one level up, resolved absolutely so cwd does not matter.
export default defineConfig({
  root: resolve(import.meta.dirname, '..'),
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
});
