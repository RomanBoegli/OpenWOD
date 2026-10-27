import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string; homepage: string };

/**
 * Four modes, two shapes. The default and `test` build the server shape (the household API on /api); `static` and
 * `static-test` build the static site: the library lives in the browser, every path is relative so one artifact
 * works under any prefix, and there is no API to proxy.
 */
export default defineConfig(({ mode }) => {
  const isStatic = mode.startsWith('static');
  const isTest = mode === 'test' || mode === 'static-test';
  return {
    root: 'apps/web',
    base: isStatic ? './' : '/',
    plugins: [react()],
    define: { __OPENWOD_TEST__: JSON.stringify(isTest), __OPENWOD_STATIC__: JSON.stringify(isStatic), __OPENWOD_VERSION__: JSON.stringify(pkg.version), __OPENWOD_REPO__: JSON.stringify(pkg.homepage) },
    // /api goes to the Fastify server (scripts/dev.mjs runs it on 8787; the Playwright config starts one in memory).
    server: { port: 5173, strictPort: true, ...(isStatic ? {} : { proxy: { '/api': { target: process.env.OPENWOD_API ?? 'http://127.0.0.1:8787', changeOrigin: false } } }) },
    build: {
      outDir: isStatic ? '../../dist/static' : '../../dist/web',
      emptyOutDir: true,
      target: ['safari16.4', 'firefox115', 'chrome115'],
      sourcemap: false,
    },
  };
});
