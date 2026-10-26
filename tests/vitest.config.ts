import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: '..',
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
});
