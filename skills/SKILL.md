---
name: three-path-editor
description: Integrate the three-path-editor package into an existing Three.js project — in-game visual editor for 2D/3D paths (linear, Catmull-Rom, Bezier), route JSON files, and PathFollower to move any Object3D along a path. Use when a Three.js game needs editable routes, waypoints, splines, patrol paths, flight paths, camera rails, or objects that follow a path.
---

# three-path-editor integration skill

`three-path-editor` plugs into an **existing** Three.js application. It never creates its own Scene, Camera, Renderer or animation loop. Your job is to find the ones the project already has and connect the package to them, without changing the project's architecture.

Package entry points:

| Import | Contains | Ship in production? |
| --- | --- | --- |
| `three-path-editor` | `Path`, `PathFollower`, `parsePathFile`, JSON helpers | Yes |
| `three-path-editor/core` | Same data and math, no Three.js import at all | Yes |
| `three-path-editor/editor` | `PathEditor`, `PathEditorPanel`, renderer, gizmos, preview | **No.** Dev only |

Companion files in this folder:
- [integration.md](integration.md): step-by-step integration patterns (plain Three.js, class-based engines, React Three Fiber, Vite/webpack guards).
- [routes.md](routes.md): route JSON format, where to keep files, loading them, following them.
- [troubleshooting.md](troubleshooting.md): symptom → cause → fix table.

---

## 0. Golden rules

1. **Inspect before you modify.** Read the project's entry point, renderer setup and update loop before writing any code. Run `npx path-editor doctor` if the package is installed.
2. **Never create a second `Scene`, `WebGLRenderer`, camera or `requestAnimationFrame` loop** for the editor. Reuse the project's own.
3. **Don't restructure the project.** Add the smallest possible integration: one dev-only editor module plus runtime follower code where the game already updates objects.
4. **Keep the editor out of production builds** (dynamic import behind a dev flag).
5. **Don't hardcode object-specific behaviour** (airplane, car...) into the package. Use `orientation` options and project-side code instead.
6. Ask the user when the choice is theirs (which object follows which route, where the routes live, which key toggles the editor). Don't guess at gameplay decisions.

## 1. Detect an existing Three.js project

- `package.json` has `three` in `dependencies`/`devDependencies`. Note the version (the package supports r150+).
- Search the sources for `from 'three'` / `require('three')`.
- `@react-three/fiber` in dependencies means a React Three Fiber project. Use the R3F pattern in integration.md.
- Other wrappers (engine classes, `ObjectLoader` scenes, game frameworks): the Three.js objects exist but are created indirectly. Find where they're stored.

`npx path-editor doctor` (or `node node_modules/three-path-editor/bin/path-editor.mjs doctor`) reports all of this. Add `--json` for machine-readable output.

## 2. Identify scene, camera, renderer and update loop

Search for these, and **read the surrounding code** to find the instance actually in use:

| Object | Look for | Notes |
| --- | --- | --- |
| Scene | `new Scene(`, `new THREE.Scene(`, `ObjectLoader().parse`, `scene.add(`, `addToScene(` | Often a singleton / static field / context property |
| Camera | `new PerspectiveCamera(`, `OrthographicCamera`, `getCamera()` | The *active* camera; games may switch cameras |
| Renderer | `new WebGLRenderer(`, `WebGPURenderer` | You only need `renderer.domElement` |
| Loop | `renderer.setAnimationLoop(`, `requestAnimationFrame(`, `useFrame(`, a `tick/update(dt)` method | Where `renderer.render(scene, camera)` is called |
| Camera controls | `OrbitControls`, `MapControls`, custom controllers | Pass as `cameraControls` so gizmo drags don't rotate the camera |

If several candidates exist (e.g. a UI scene and a world scene), pick the one where game objects live and tell the user which you chose.

## 3. Install and initialize

```bash
npm install three-path-editor                  # from npm, once published
npm install github:<owner>/three-js-path-editor  # from Git (builds on install via `prepare`)
npx path-editor init       # creates src/paths/example.paths.json + installs this skill in .claude/skills/
npx path-editor doctor     # verify
```

`init` and `doctor` never overwrite or delete files. For TypeScript projects make sure `@types/three` is installed.

## 4. Avoid duplicate scenes/renderers

Wrong:
```ts
const scene = new THREE.Scene();              // ❌ a second scene nobody renders
const renderer = new THREE.WebGLRenderer();   // ❌ a second canvas
function loop() { requestAnimationFrame(loop); editor.update(); renderer.render(scene, camera); } // ❌ second loop
```
Right:
```ts
const editor = new PathEditor({ scene: game.scene, camera: game.camera, renderer: game.renderer });
// inside the game's existing update(dt):
editor.update(dt);
```

## 5. Integrate the editor into an existing game

Create **one** dev-only module (e.g. `src/dev/pathEditor.ts`) and call it from the place where scene/camera/renderer are available:

```ts
// src/dev/pathEditor.ts
import type { Camera, Object3D, WebGLRenderer } from 'three';

export async function setupPathEditor(ctx: {
  scene: Object3D; camera: Camera; renderer: WebGLRenderer;
  controls?: { enabled: boolean }; routes?: unknown;
}) {
  const { PathEditor, PathEditorPanel } = await import('three-path-editor/editor');
  const editor = new PathEditor({
    scene: ctx.scene, camera: ctx.camera, renderer: ctx.renderer,
    cameraControls: ctx.controls ?? null,
  });
  if (ctx.routes) editor.import(ctx.routes);
  editor.enable();
  new PathEditorPanel(editor, { container: ctx.renderer.domElement.parentElement ?? undefined });
  return editor;
}
```

```ts
// where the game is set up (existing file, minimal change)
let pathEditor: { update(dt: number): void } | null = null;
if (import.meta.env.DEV) {
  import('./dev/pathEditor').then(async (m) => {
    pathEditor = await m.setupPathEditor({ scene, camera, renderer, controls, routes });
  });
}
// in the existing loop:
pathEditor?.update(dt);
```

Editor controls: click a point to select it, drag the gizmo to move it, **Shift+click** empty space to add a point, **Shift+click or double-click the line** to insert a point on the curve, **Delete** to remove it, `[`/`]` to step through points, `Alt+[`/`]` to reorder them, `G` to toggle the gizmo, **Cmd/Ctrl+Z** to undo, **Cmd/Ctrl+Shift+Z** to redo. The panel covers everything else: curve type, closed, tension, per-point *Speed ×* and *Roll °*, **Delete path**, view toggles, preview, export/import.

If the game switches cameras, call `editor.setCamera(newCamera)`.

### 5b. Real-game pitfalls (check these every time)

Overlays covering the canvas, the game's own window-level input, cameras locked to a rig, saving back into the project, hardcoded routes and curve mismatches. See [integration.md § H](integration.md). The package gives you the pieces: `inputblocked`, the `enabled` event, `FlyControls`, `restoreCameraOnDisable`, `pathEditorSavePlugin`/`saveToDevServer`, `saveSession`/`restoreSession`, `canEdit`, `constrainWaypoint`/`surfaceConstraint`, `labelFormatter`/`formatWaypoint` and `curve.parametrization`. Keep game-specific behaviour (pausing, hiding HUD, muting input) in the host, inside `editor.on('enabled', ...)`.

## 6. Add route JSON files

See [routes.md](routes.md). Short version: keep routes in `src/paths/*.paths.json` (bundled with `import`) or `public/paths/` (loaded with `fetch`). Design routes in the editor, click **Export**, and save the file into the project. Preserve unknown fields: the format round-trips them.

## 7. Attach an existing game object as preview/follower

Preview in the editor (it restores the object's original transform when the preview stops):
```ts
editor.attachPreview(helicopterObject, 'helicopter-route', {
  speed: 15,
  orientation: { forward: [0, 0, -1] }, // model faces -Z
});
```

Keep the object's own state (animation clip, sounds, effects) in sync through events. **Never poll `editor.preview?.isPlaying` every frame.** The events fire for panel buttons, API calls, the end of a `loop: 'none'` path and detach:
```ts
editor.on('previewstate', ({ preview, playing }) => {
  if (preview.object === enemy.root) enemy.playClipFor(playing); // walk while playing, idle otherwise
});
```
- `previewstate` fires once per real change: after `preview` when an attached preview starts playing (the default), and with `playing: false` when a playing preview is detached.
- Per preview: `preview.on('play' | 'pause' | 'reset' | 'complete' | ..., fn)`, or the options `onPlay`, `onPause`, `onReset`. Listeners survive `setPath`/`previewPath`.
- `PathFollower` has the same `play`/`pause`/`reset` events and `onPlay`/`onPause`/`onReset` options. With loop `'none'`, the end emits `complete`, then `pause`.

Runtime (production):
```ts
import { PathFollower, getPathFromFile } from 'three-path-editor';
import routes from './paths/level1.paths.json';

const follower = new PathFollower({
  object: helicopter,
  path: getPathFromFile(routes, 'helicopter-route'),
  speed: 12,          // world units / second
  loop: true,         // or 'pingpong', or false
  orientation: { forward: [0, 0, -1], smoothing: 6 },
  onComplete: () => game.onRouteFinished(),
});
// in the existing loop:
follower.update(dt);
```

Speed changes and banking (e.g. a helicopter leaning into turns) belong in the route data: set `speed` (multiplier) and `roll` (degrees, positive = bank right) on waypoints in the editor. Don't hardcode them in game code. If a model banks the wrong way, use `orientation: { rollScale: -1 }`.

Find the model's forward axis by checking which way it faces at rotation 0. Common values: `[0,0,1]` (+Z, default, matches `lookAt`), `[0,0,-1]`, `[1,0,0]`. Use `yawOnly: true` for ground vehicles and characters, and `orientation: false` to only move the object.

If the object is already driven by game code each frame (physics, animation), don't fight it: either pause that code while following, or read `path.getPointAt(u)` / `path.getTangentAt(u)` and feed the values into the game's own movement code.

## 8. Debug common integration problems

Run `npx path-editor doctor` first. Then see [troubleshooting.md](troubleshooting.md). Most common:
- Nothing visible → `editor.enable()` not called, `editor.update(dt)` not called in the loop, or wrong scene/camera.
- Camera rotates while dragging → pass `cameraControls`.
- Clicks don't select → an overlay element covers the canvas, or you passed the wrong `domElement`.
- Model flies sideways → wrong `orientation.forward`.

## 9. Disable the editor for production

- Only import `three-path-editor/editor` via dynamic `import()` behind `import.meta.env.DEV` (Vite), `process.env.NODE_ENV !== 'production'` (webpack), or a project flag. The bundler then drops it from production builds.
- Production code imports only from `three-path-editor` (or `/core`).
- At runtime you can also call `editor.disable()` (removes everything from the scene and all listeners) or `editor.dispose()` (also frees GPU resources).
- `doctor` warns about static editor imports without a dev guard.

## 10. Preserve the project's architecture

- Follow the project's existing patterns: if it uses controller classes, put the editor behind a small controller. If it uses ECS, a system. If it uses R3F, a component.
- Match code style, module system, naming and folder layout.
- Don't reformat or refactor unrelated code. Don't change the project's coordinate system: use `coordinates` options (`plane2D`, `origin`, `scale`) or a custom `CoordinateSystem` instead.
- Don't modify game materials/objects. All editor objects live under `editor.root` (`userData.pathEditor === true`).
- If the game raycasts against `scene.children`, make sure it ignores objects with `userData.pathEditor` (or disable the editor in those builds).
- Summarize for the user exactly which files you changed and why.
