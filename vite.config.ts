import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  root: 'apps/web',
  plugins: [react()],
  define: { __WODVA_TEST__: JSON.stringify(mode === 'test') },
  server: { port: 5173, strictPort: true },
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
    target: ['safari16.4', 'firefox115', 'chrome115'],
    sourcemap: false,
  },
}));
