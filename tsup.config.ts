import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    // Runtime: Path, PathFollower, JSON. No editor code.
    index: 'src/index.ts',
    // Pure path math and serialization. No Three.js import at all.
    core: 'src/core/index.ts',
    // Visual editor (PathEditor, renderer, gizmos, panel). Dev-time only.
    editor: 'src/three/index.ts',
    // Vite dev-server plugin (Node side). No Three.js, no browser code.
    vite: 'src/vite/index.ts',
  },
  format: ['esm'],
  target: 'es2020',
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: true,
  treeshake: true,
  external: ['three', /^three\//],
});
