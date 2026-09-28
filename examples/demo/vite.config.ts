import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The demo imports the package by name; alias it to the local sources so
// changes are picked up without rebuilding.
const src = (p: string) => fileURLToPath(new URL(`../../src/${p}`, import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    alias: [
      { find: /^three-path-editor\/editor$/, replacement: src('three/index.ts') },
      { find: /^three-path-editor\/core$/, replacement: src('core/index.ts') },
      { find: /^three-path-editor$/, replacement: src('index.ts') },
    ],
  },
  server: { open: true },
});
