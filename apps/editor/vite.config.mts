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
  // Vitest resolves through the SSR/node pipeline, which does NOT inherit
  // resolve.conditions above. Without this it falls back to the `import`
  // condition — packages/editor-core/dist/index.js — and tests run against
  // whatever was last built instead of the source they are meant to cover.
  ssr: {
    resolve: {
      conditions: ['@acip/source'],
    },
  },
  // HeroUI pulls ~58 react-aria-components subpaths. Pre-bundle it eagerly so
  // the dev optimizer cannot stall (and full-reload) on first popover open.
  optimizeDeps: {
    include: ['@heroui/react'],
  },
  // 4210 was inside a Windows reserved TCP range (netsh excludedportrange
  // covers 4113-4212 here), so binding failed with EACCES even though nothing
  // was listening. 5210 sits clear of those ranges.
  server: {
    port: 5210,
    host: 'localhost',
  },
  preview: {
    port: 5210,
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
