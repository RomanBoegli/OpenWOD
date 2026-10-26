import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string; homepage: string };

export default defineConfig(({ mode }) => ({
  root: 'apps/web',
  plugins: [react()],
  define: { __OPENWOD_TEST__: JSON.stringify(mode === 'test'), __OPENWOD_VERSION__: JSON.stringify(pkg.version), __OPENWOD_REPO__: JSON.stringify(pkg.homepage) },
  // /api goes to the Fastify server (scripts/dev.mjs runs it on 8787; the Playwright config starts one in memory).
  server: { port: 5173, strictPort: true, proxy: { '/api': { target: process.env.OPENWOD_API ?? 'http://127.0.0.1:8787', changeOrigin: false } } },
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
    target: ['safari16.4', 'firefox115', 'chrome115'],
    sourcemap: false,
  },
}));
