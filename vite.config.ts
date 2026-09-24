/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the production build works from any static host or sub-path.
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5188,
    strictPort: true,
    // Playtests write screenshots and browser profiles under artifacts/;
    // watching them only costs time, and Chromium's locked profile files
    // crash the watcher on Windows (EBUSY).
    watch: { ignored: ['**/artifacts/**', '**/dist/**', '**/client-finder-run/**'] },
  },
  preview: {
    host: '127.0.0.1',
    port: 4188,
    strictPort: true,
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1600,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
