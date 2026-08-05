/// <reference types='vitest' />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/editor',
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
    },
    // resolve @acip/editor-core to its TypeScript source in dev/build —
    // no prebuild step (matches customConditions in tsconfig.base.json)
    conditions: ['@acip/source'],
  },
  // HeroUI pulls ~58 react-aria-components subpaths. Pre-bundle it eagerly so
  // the dev optimizer cannot stall (and full-reload) on first popover open.
  optimizeDeps: {
    include: ['@heroui/react'],
  },
  server: {
    port: 4210,
    host: 'localhost',
  },
  preview: {
    port: 4210,
    host: 'localhost',
  },
  plugins: [react(), tailwindcss()],
  // Uncomment this if you are using workers.
  // worker: {
  //  plugins: [],
  // },
  build: {
    outDir: './dist',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
}));
