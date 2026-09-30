# Integration patterns

Always start by reading the project. Find the scene, camera, renderer, loop and camera controls (see SKILL.md §2), then choose the pattern that matches the project's existing structure.

## Checklist

- [ ] `three` is installed (r150+). For TypeScript, `@types/three` is installed.
- [ ] `three-path-editor` is installed.
- [ ] You found the **existing** scene, active camera, renderer (`domElement`) and per-frame update.
- [ ] The editor is created once, in dev builds only, with those objects.
- [ ] `editor.enable()` is called.
- [ ] `editor.update(dt)` is called from the existing loop.
- [ ] Camera controls are passed as `cameraControls` (if any).
- [ ] Route JSON lives in the project and is loaded with `parsePathFile` / `getPathFromFile`.
- [ ] Followers call `follower.update(dt)` from the existing loop.
- [ ] Production build contains no `three-path-editor/editor` code.
- [ ] Clicking a path selects it (no `inputblocked` warning in the console). If not, see H.
- [ ] If the game camera is locked to a rig/player, a free camera is available while editing (H).
- [ ] The runtime curve and the editor curve match (`curve.parametrization`, H).

## A. Plain Three.js (module-level objects)

```ts
// main.ts (existing)
const renderer = new THREE.WebGLRenderer();
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 2000);
const controls = new OrbitControls(camera, renderer.domElement);

// + added
let pathEditor: import('three-path-editor/editor').PathEditor | null = null;
if (import.meta.env.DEV) {
  const { PathEditor, PathEditorPanel } = await import('three-path-editor/editor');
  pathEditor = new PathEditor({ scene, camera, renderer, cameraControls: controls });
  pathEditor.enable();
  new PathEditorPanel(pathEditor);
}

renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  // ...existing game update...
  pathEditor?.update(dt);                 // + added
  renderer.render(scene, camera);
});
```

Top-level `await` needs ES2022 modules. Otherwise use `import(...).then(...)`.

## B. Class-based engines / controllers

Many games keep Three.js objects in singletons or controllers (`Game.scene`, `ThreeC.renderer`, `CameraC.camera`). Add a small dev-only controller that follows the same conventions:

```ts
// src/controllers/PathEditorC.ts (dev only)
import type { PathEditor } from 'three-path-editor/editor';

export class PathEditorC {
  private static editor: PathEditor | null = null;

  static async init(): Promise<void> {
    if (!import.meta.env.DEV) return;
    const { PathEditor, PathEditorPanel } = await import('three-path-editor/editor');
    this.editor = new PathEditor({
      scene: ThreeC.scene,          // use the project's real accessors
      camera: CameraC.camera,
      renderer: ThreeC.renderer,
    });
    this.editor.enable();
    new PathEditorPanel(this.editor);
  }

  static update(dt: number): void {
    this.editor?.update(dt);
  }

  /** Call when the game switches cameras. */
  static setCamera(camera: THREE.Camera): void {
    this.editor?.setCamera(camera);
  }
}
```

Register `PathEditorC.update(dt)` wherever other controllers are updated. Don't create a new loop.

## C. React Three Fiber

```tsx
import { useThree, useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import type { PathEditor } from 'three-path-editor/editor';

export function PathEditorDev({ routes }: { routes?: unknown }) {
  const { scene, camera, gl, controls } = useThree();
  const editorRef = useRef<PathEditor | null>(null);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    let disposed = false;
    let panel: { dispose(): void } | undefined;
    import('three-path-editor/editor').then(({ PathEditor, PathEditorPanel }) => {
      if (disposed) return;
      const editor = new PathEditor({ scene, camera, renderer: gl, cameraControls: controls as any });
      if (routes) editor.import(routes);
      editor.enable();
      panel = new PathEditorPanel(editor);
      editorRef.current = editor;
    });
    return () => {
      disposed = true;
      panel?.dispose();
      editorRef.current?.dispose();
      editorRef.current = null;
    };
  }, [scene, gl]);

  useEffect(() => editorRef.current?.setCamera(camera), [camera]);
  useFrame((_, dt) => editorRef.current?.update(dt));
  return null;
}
```

Use `<OrbitControls makeDefault />` so `controls` is available from `useThree()`.

## D. Production guards per bundler

| Bundler | Guard |
| --- | --- |
| Vite | `if (import.meta.env.DEV) { await import('three-path-editor/editor') }` |
| webpack / Next.js | `if (process.env.NODE_ENV !== 'production') { ... }` |
| esbuild | `--define:process.env.NODE_ENV=\"production\"` + the webpack guard |
| No bundler | Load the editor module only from a dev HTML page / query flag (`?editor`) |

Keep the guard **around the dynamic import**, not inside the editor module. A static `import ... from 'three-path-editor/editor'` at the top of a production file bundles the editor even if it's never used.

Single-file builds (playable ads, `vite-plugin-singlefile`) inline dynamic imports. The guard still removes the editor because `import.meta.env.DEV` is statically `false` in production.

## E. Toggling at runtime

```ts
addEventListener('keydown', (e) => {
  if (e.code === 'F2') editor.toggle();   // choose a key the game doesn't use
});
```

`disable()` removes `editor.root` from the scene and all DOM listeners. Paths stay loaded. `dispose()` frees everything.

## F. Custom placement (click on terrain/map)

Shift+click uses `planePlacement()` by default (the horizontal plane through the selected point). To place points on real geometry:

```ts
import { objectPlacement } from 'three-path-editor/editor';
editor.placement = objectPlacement(() => [terrainMesh], { surfaceOffset: 2 });
```

Or write a `PlacementProvider` that uses the project's own raycasting or heightmap.

## G. Coordinate conventions

Default: Y-up. 3D paths are stored in world coordinates. 2D paths `[x, y]` map to world `(x, 0, y)` on the XZ plane. Change this with `coordinates`, and pass the **same** coordinate system to the editor and to every `PathFollower`:

```ts
import { createCoordinateSystem } from 'three-path-editor';
const coordinates = createCoordinateSystem({ plane2D: 'xy', elevation2D: 0, origin: [0, 0, 0], scale: 1 });
new PathEditor({ scene, camera, renderer, coordinates });
new PathFollower({ object, path, coordinates });
```

For a fully custom mapping, implement the `CoordinateSystem` interface (`toWorld`, `toPath`, `directionToWorld`, `planeNormal`).

## H. Real games: HUD overlays, locked cameras, own input, saving

Check these before calling the integration done. Keep every game-specific part in the host project, driven by the `enabled` event. None of it belongs in the package.

1. **Overlays.** Full-screen DOM layers above the canvas (HUD, loader, an invisible "redirect" layer) swallow the editor's clicks. The editor logs the covering element once and emits `inputblocked`. Make those layers `pointer-events: none` while editing, and restore them afterwards. Never touch elements with `data-path-editor-ui` (the panel).
2. **Game input.** Games often listen on `window` (mouse/touch). In `editor.on('enabled', on => ...)`, stop those events in the capture phase while editing. The editor only needs `pointer*`, `click`, `dblclick` and `keydown`.
3. **Camera.** If the camera is attached to a rig, use `FlyControls` as `cameraControls`, with `restoreCameraOnDisable: true`. Toggle `fly.enabled` from the `enabled` event and call `fly.update(dt)` in the loop. Hide meshes parented to the camera (weapons, cockpits) while editing, and pause the game (time scale, route followers).
4. **Saving.** Vite: add `pathEditorSavePlugin({ file })` to the config and `onSave: json => (editor.saveSession(), saveToDevServer(json))` to the panel. Call `editor.restoreSession()` after `import()`. The dev server must be restarted after the config change.
5. **Hardcoded routes.** If the game keeps routes as constants in code, move the points into the path file and read them from there. Keep any extra per-point data (timings, flags, look targets) in `metadata`. Look points up by a stable `metadata.name` rather than by index, so inserting points doesn't shift them. Then protect named points with `canEdit` (`deleteWaypoint`), and show the names with `labelFormatter` / `formatWaypoint`.
6. **Curve match.** Set `curve.parametrization` to what the runtime uses (`CatmullRomCurve3(..., 'centripetal')` → `'centripetal'`). If the runtime walks straight segments, use `curve: 'linear'` and deny `editCurve` for those paths.
7. **Animation state during preview.** When a game object (character, vehicle) is attached with `attachPreview`, drive its animation from `editor.on('previewstate', ({ preview, playing }) => ...)`, filtered by `preview.object`. Don't poll `isPlaying`. Stop the game's own animation/AI driver for that object while it's previewed (see 3), and give control back when the `preview` event reports `null`.
8. **Ground routes.** Use `constrainWaypoint: surfaceConstraint(() => [terrain], { filter })`, then `editor.applyConstraints()` after import. Shift+click placement can differ per path: `placement` receives `ctx.path`.
