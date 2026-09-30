# three-path-editor

A reusable, framework-agnostic **path editor and path follower for existing Three.js projects**.

- 2D and 3D paths: **linear**, **Catmull-Rom** and **Bezier** curves
- In-game visual editor: select, add, delete, drag (TransformControls) and reorder waypoints, Bezier handles, direction arrows, labels, grid, debug view
- Multiple paths per scene, versioned JSON import/export that **preserves unknown metadata**
- `PathFollower`: moves any `Object3D` along a path at constant speed, with configurable orientation, looping and events
- **Per-waypoint speed and bank (roll)**: slow down before a turn, bank a helicopter into it
- Preview any game object along a path from the editor
- **Plugs into your app.** It never creates a Scene, Camera, Renderer or animation loop
- **Editor is optional.** Production builds can ship only `Path` + `PathFollower` + JSON
- Claude Code skill and a `doctor` CLI for AI-assisted integration

<p align="center"><em>Run <code>npm run demo</code> to try it.</em></p>

---

## Contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [Integrating into an existing Three.js app](#integrating-into-an-existing-threejs-app)
- [Complex projects: overlays, game input, cameras, saving](#complex-projects-overlays-game-input-cameras-saving)
- [Creating a path](#creating-a-path)
- [Editing a path](#editing-a-path)
- [Path JSON format](#path-json-format)
- [PathFollower](#pathfollower)
- [Preview objects](#preview-objects)
- [2D paths](#2d-paths) · [3D paths](#3d-paths)
- [Production / runtime usage](#production--runtime-usage)
- [AI / Claude Code integration](#ai--claude-code-integration)
- [CLI](#cli)
- [Troubleshooting](#troubleshooting)
- [API overview](#api-overview)
- [Development](#development)

---

## Installation

```bash
# from Git (until published to npm). The package builds itself on install via `prepare`.
npm install github:ka2nq1/three-js-path-editor

# once published
npm install three-path-editor
```

Peer dependency: `three` **r150 or newer**. TypeScript users should also install `@types/three`.

## Quick start

```ts
import * as THREE from 'three';
import { PathEditor, PathEditorPanel } from 'three-path-editor/editor';

// Your existing app
const renderer = new THREE.WebGLRenderer();
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 2000);
const controls = new OrbitControls(camera, renderer.domElement);

// Editor: attaches to what you already have
const editor = new PathEditor({ scene, camera, renderer, cameraControls: controls });
editor.createPath({
  id: 'helicopter-route',
  dimension: 3,
  curve: 'catmull-rom',
  points: [[0, 20, 0], [30, 30, -50], [80, 50, -100]],
});
editor.enable();
new PathEditorPanel(editor); // optional DOM panel

// Your existing loop
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  editor.update(dt);
  renderer.render(scene, camera);
});
```

## Integrating into an existing Three.js app

The package needs four things your app already has:

| You provide | Used for |
| --- | --- |
| `scene` | The editor adds **one** group (`editor.root`) to it on `enable()` and removes it on `disable()` |
| `camera` | Picking, gizmos, constant-size markers. Call `editor.setCamera(cam)` if the active camera changes |
| `renderer` (or `domElement`) | Pointer input on `renderer.domElement` |
| your update loop | Call `editor.update(dt)` and `follower.update(dt)` once per frame |

Rules the package follows:

- It creates no scene, camera, renderer or `requestAnimationFrame` loop.
- It never modifies your objects or materials. Everything it draws is under `editor.root` and marked `userData.pathEditor = true`.
- Editor overlays render on top of the scene (`depthTest: false`, high `renderOrder`), so you can see paths through buildings and terrain.
- While a gizmo is being dragged, `cameraControls.enabled` is set to `false` and restored afterwards.

Load the editor only in development:

```ts
let editor: import('three-path-editor/editor').PathEditor | undefined;
if (import.meta.env.DEV) {
  const { PathEditor, PathEditorPanel } = await import('three-path-editor/editor');
  editor = new PathEditor({ scene, camera, renderer, cameraControls: controls });
  editor.import(routes);
  editor.enable();
  new PathEditorPanel(editor);
}
// in the loop
editor?.update(dt);
```

More patterns (engine/controller classes, React Three Fiber, webpack guards) are in [skills/integration.md](skills/integration.md).

## Complex projects: overlays, game input, cameras, saving

Real games are rarely a bare canvas. These are the usual traps and the package pieces that cover them. Everything here is opt-in. The package never guesses about your DOM, input system or camera rig: it gives you the hooks, and your project decides.

### HTML overlays covering the canvas

The editor listens for pointer input on `domElement` (default `renderer.domElement`). A full-screen HUD, loader or "redirect" layer above the canvas swallows those clicks, even when it is invisible (`opacity: 0`). Your game may not notice, because it listens on `window`, but the editor never sees the press.

The editor detects this. The first time a press inside the canvas area lands on another element, it logs which element was hit (e.g. `<div#interactive>`), and it emits `inputblocked` on every such press:

```ts
editor.on('inputblocked', ({ target }) => console.log('covered by', target));
```

Two ways to fix it:

- Make the covering layers click-through while editing (`pointer-events: none`), from your `enabled` handler (see below).
- Or pass an element that does receive the input as `domElement`. It must cover the canvas exactly, because picking maps pointer coordinates through its rectangle.

Give your own dev UI the `data-path-editor-ui` attribute so it is not reported. The panel already has it. Turn the console message off with `diagnostics: false`.

### Pausing the game and muting its input

Use the `enabled` event. It fires on every `enable()` / `disable()`, and is the place for project-specific behavior: freeze time, hide the HUD, stop the game from shooting on clicks.

```ts
const block = (e: Event) => e.stopPropagation();
editor.on('enabled', (on) => {
  game.paused = on;
  hud.hidden = on;
  for (const type of ['mousedown', 'mouseup', 'touchstart', 'touchend']) {
    if (on) window.addEventListener(type, block, true);
    else window.removeEventListener(type, block, true);
  }
});
```

The editor itself only uses `pointer*`, `click`, `dblclick` and `keydown` events, so blocking `mouse*` / `touch*` like this doesn't affect it. Which events to block depends on your game.

### A free camera for editing

If the game camera is attached to a player, vehicle or rail, you can't look around to edit. `FlyControls` is a small free-fly camera you drive yourself: WASD to move, E/Q or Space/C for up/down, right-drag or arrow keys to look, wheel to change speed, Shift to boost. It ignores keys typed into inputs and keys pressed with Cmd/Ctrl, so shortcuts keep working.

```ts
import { FlyControls, PathEditor } from 'three-path-editor/editor';

const fly = new FlyControls(camera, { speed: 20, enabled: false });
const editor = new PathEditor({ scene, camera, renderer, cameraControls: fly, restoreCameraOnDisable: true });
editor.on('enabled', (on) => (fly.enabled = on));
// in your loop
fly.update(dt);
editor.update(dt);
```

- Passing it as `cameraControls` pauses look-dragging while a gizmo is dragged.
- `restoreCameraOnDisable` puts the camera back where the game had it when you stop editing.
- The camera moves in its parent's space. If your rig parents the camera to a moving object, move it to the scene while flying, or have your `enabled` handler stop the rig from driving it.
- Objects attached to the camera (a weapon, a cockpit) fly along with it. Hide them in the `enabled` handler if they get in the way.

### Saving straight into the project (Vite)

`three-path-editor/vite` adds a dev-server endpoint that writes the exported file into your project. The file is validated with the same parser the game uses. Vite then reloads the page because the file changed.

```ts
// vite.config.ts
import { pathEditorSavePlugin } from 'three-path-editor/vite';
export default { plugins: [pathEditorSavePlugin({ file: 'src/paths/level1.paths.json' })] };
```

```ts
import { PathEditorPanel, saveToDevServer } from 'three-path-editor/editor';

editor.restoreSession(); // right after import(): resumes editing after the reload a save causes
new PathEditorPanel(editor, {
  onSave: (json) => {
    editor.saveSession(); // enabled state, selection, view toggles, camera pose
    return saveToDevServer(json);
  },
});
```

- The plugin is dev-server only (`apply: 'serve'`) and never runs in builds.
- Options: `endpoint` (default `/__path-editor/save`), `indent`, `maxBytes`, and `writeFile` for custom storage.
- Not on Vite? `saveToDevServer` only POSTs the JSON, so any endpoint that writes the body to disk works. `onSave` can also do anything else, like `navigator.clipboard.writeText(json)`.

### Protecting what your code depends on

Game code often looks points up by metadata (`metadata.name`), or expects a path to stay a certain curve type. `canEdit` decides which edits the editor may make. It applies to editor methods, keyboard shortcuts, the gizmo and the panel. Refused edits emit `denied`.

```ts
new PathEditor({
  ...,
  canEdit: (action, { path, waypointIndex }) => {
    if (action === 'deleteWaypoint' && waypointIndex !== null) return !path.waypoints[waypointIndex].metadata.name;
    if (action === 'editCurve') return !path.metadata.fixedCurve;
    return true;
  },
});
```

Actions: `addWaypoint`, `deleteWaypoint`, `moveWaypoint`, `reorderWaypoint`, `editWaypointProperties` (speed/roll), `deletePath`, `renamePath`, `editCurve`, `editMetadata`. Direct `Path` method calls are not checked.

The panel shows point and path metadata as editable JSON. It doesn't know what any key means. Use `formatWaypoint` (panel list) and `render.labelFormatter` (3D labels) to show your own names:

```ts
const name = ({ waypoint, index }) => (waypoint.metadata.name as string) ?? String(index);
new PathEditor({ ..., render: { labelFormatter: name } });
new PathEditorPanel(editor, { formatWaypoint: name });
```

### Keeping points on the ground (or any rule)

`constrainWaypoint` adjusts every position the editor places or moves: gizmo drags, Shift+click, inserts and typed coordinates. `surfaceConstraint` drops points onto the highest surface under them:

```ts
import { surfaceConstraint } from 'three-path-editor/editor';

const editor = new PathEditor({
  ...,
  constrainWaypoint: surfaceConstraint(() => [terrain], { offset: 0.2, filter: (path) => path.metadata.ground === true }),
});
editor.import(routes);
editor.applyConstraints(); // snap existing points once, one undo step
```

Write your own for other rules, e.g. `({ position }) => position.setY(10)` for a fixed altitude. `placement` (where Shift+click lands) receives the path too, so it can differ per path.

### Making the editor draw the curve your game follows

If your runtime uses `THREE.CatmullRomCurve3` with `'centripetal'` or `'chordal'`, set the same knot spacing on the path. The editor then draws exactly that curve. It is verified point-for-point against three.js.

```json
"curve": { "type": "catmull-rom", "parametrization": "centripetal" }
```

The default `'uniform'` with `tension` 0.5 is three's `'catmullrom'`. The panel exposes this as **Spacing**.

### TypeScript with `moduleResolution: "node"`

Older templates still use `"moduleResolution": "node"`, which ignores the `exports` map. The package also ships `typesVersions`, so `three-path-editor/editor`, `/core` and `/vite` resolve their types there too.

## Creating a path

With the editor:

```ts
const path = editor.createPath({ id: 'patrol-a', dimension: 3, curve: 'catmull-rom' }); // adds + selects
editor.createPathInView({ dimension: 2 }); // 3 points in front of the camera (scale-independent)
editor.loadPath(pathOrJson);               // add an existing Path or PathData (replaces same id)
```

Without the editor (runtime or tools):

```ts
import { Path } from 'three-path-editor';

const path = new Path({
  id: 'patrol-a',
  dimension: 3,
  curve: { type: 'catmull-rom', closed: true, tension: 0.5 },
  points: [[0, 0, 0], [10, 0, 0], { position: [10, 0, 10], metadata: { wait: 2 } }],
});
path.addWaypoint([0, 0, 10]);
path.moveWaypoint(0, [0, 1, 0]);
path.reorderWaypoint(3, 1);
path.removeWaypoint(2);
path.setCurve({ type: 'bezier' });
path.events.on('change', () => console.log('changed', path.length));
```

## Editing a path

| Action | Mouse / keyboard | API |
| --- | --- | --- |
| Select path | click its line | `editor.select(pathId)` |
| Select waypoint | click marker | `editor.select(pathId, index)` |
| Move waypoint | drag gizmo | `editor.moveWaypoint(pathId, index, [x, y, z])` |
| Add waypoint | **Shift+click** empty space (placed via `editor.placement`) / `+` | `editor.addWaypoint()` / `editor.addWaypointAtScreen(x, y)` |
| Insert waypoint on the curve | **Shift+click** or **double-click** the path line | `editor.insertWaypointAt(pathId, t)` / `editor.insertWaypointAtScreen(x, y)` |
| Speed / roll of a waypoint | panel: *Speed ×*, *Roll °* | `path.setWaypointProperties(i, { speed, roll })` |
| Delete whole path | panel: **Delete path** (asks for confirmation) | `editor.deleteSelectedPath()` / `editor.removePath(id)` |
| Delete waypoint | `Delete` / `Backspace` | `editor.deleteSelectedWaypoint()` |
| Reorder waypoint | `Alt+[` / `Alt+]` | `editor.reorderWaypoint(pathId, from, to)` |
| Prev / next waypoint | `[` / `]` | `editor.selectAdjacentWaypoint(±1)` |
| Deselect | `Escape`, click empty space | `editor.clearWaypointSelection()` |
| Toggle gizmos | `G` | `editor.toggleView('gizmos')` |
| Undo / redo | **Cmd/Ctrl+Z** / **Cmd/Ctrl+Shift+Z** (or Ctrl+Y), panel ↶ ↷ | `editor.undo()` / `editor.redo()` |
| Toggle path / arrows / labels / grid / debug | panel | `editor.setView({ paths, directions, labels, grid, debug })` |
| Bezier handles | select a point on a Bezier path, then click and drag a handle | `path.setWaypointHandles(i, { handleIn, handleOut })` |

Inserting on the curve keeps the shape: exact for Bezier (de Casteljau split), and for other curve types the new point lies on the old curve. The new point's speed and roll are interpolated from its neighbours.

A new waypoint goes after the selected one: on the curve between two points, or extended past the last point. Shift+click placement uses `planePlacement()` by default (the horizontal plane through the selected point, or the 2D plane for 2D paths). To place points on your own geometry (terrain, a map mesh):

```ts
import { objectPlacement } from 'three-path-editor/editor';
editor.placement = objectPlacement(() => [terrain], { surfaceOffset: 1 });
```

**Undo/redo.** Every edit is undoable: moves, adds, inserts, deletes (including whole paths), reorders, curve settings, speed/roll, renames. A gizmo drag counts as one step, and so does any compound operation. Undo restores the same `Path` objects, so followers that reference a deleted-then-restored path keep working. The selection is restored too. Shortcuts use the physical key, so they work with any keyboard layout. Inside panel text fields the browser's own undo applies. `editor.import()` starts a fresh history (pass `{ clearHistory: false }` to keep it). You can also call `editor.history.begin()` / `end()` to group your own scripted edits, and `editor.history.clear()` to reset. The default limit is 100 steps (`historyLimit` option).

Editor events: `change`, `select`, `view`, `pathadded`, `pathremoved`, `import`, `dragstart`, `dragend`, `enabled`, `preview`, `previewstate`, `history`, `inputblocked`, `denied`
- `PathPreview`: `play`, `pause`, `toggle`, `reset`, `setProgress`, `setPath`, `on`, `detach`, `isPlaying`, `speed`, `loop`, `progress`, `object`, `follower`:

```ts
editor.on('dragend', ({ path }) => autosave(editor.exportString()));
```

The `PathEditorPanel` is optional. It's plain DOM with no dependencies, and gives you path list, id rename, curve type, closed, tension, waypoint list with XYZ fields, view toggles, preview controls, and JSON export/copy/import. Games with their own dev UI can call the API directly.

## Path JSON format

```json
{
  "version": 1,
  "paths": [
    {
      "id": "helicopter-route",
      "dimension": 3,
      "curve": { "type": "catmull-rom", "closed": false, "tension": 0.5 },
      "points": [
        { "position": [0, 20, 0] },
        { "position": [30, 30, -50] },
        { "position": [80, 50, -100] }
      ],
      "metadata": {}
    }
  ]
}
```

- `dimension: 2` paths store `[x, y]` positions.
- Optional per-point `speed` (multiplier, default 1) and `roll` (bank in degrees, default 0, positive = bank right). See [Speed and bank per waypoint](#speed-and-bank-per-waypoint).
- `curve.type`: `linear`, `catmull-rom` or `bezier`. Bezier points may have `handleIn` / `handleOut` offsets (relative to the point). Missing handles are generated automatically, and an unedited Bezier path matches the Catmull-Rom path exactly.
- `metadata` (paths and points) and **any unknown key** at file, path or point level is preserved on import → export.
- Files with a newer `version` are rejected with a clear `PathFormatError`, so old game builds never silently misread new files.

```ts
editor.export();          // PathFileData object
editor.exportString();    // pretty JSON
editor.import(json);      // replace all paths (object or string)
editor.import(json, { merge: true });
```

See [skills/routes.md](skills/routes.md) for the full field reference and authoring workflow.

## PathFollower

```ts
import { PathFollower } from 'three-path-editor';

const follower = new PathFollower({
  object: helicopter,     // any Object3D
  path,
  speed: 10,              // units per second, constant along the curve
  loop: true,             // false (default) | true | 'loop' | 'pingpong'
  orientation: {
    forward: [0, 0, -1],  // model's local forward axis (default +Z)
    up: [0, 1, 0],        // model's local up axis
    yawOnly: false,       // true = only rotate around worldUp (cars, characters)
    smoothing: 6,         // 0 = snap; higher = faster convergence
    offset: [0, 0, 0],    // extra model-space rotation (radians)
  },
  onWaypoint: ({ index }) => {},
  onLoop: ({ count, direction }) => {},
  onComplete: () => {},
  onPlay: () => {},       // playback started
  onPause: () => {},      // playback stopped (pause(), or the end with loop 'none')
  onReset: () => {},
});

// in your loop
follower.update(dt);

follower.pause(); follower.play(); follower.reset();
follower.setProgress(0.5);
follower.speed = 20;
follower.speedModifier = ({ progress }) => (progress > 0.9 ? 0.4 : 1); // slow down at the end
```

- Movement uses arc-length parameterization, so speed doesn't depend on waypoint spacing.
- Orientation comes from the curve tangent and maps the model's `forward` axis onto the travel direction. In `pingpong` mode the object turns around (`faceTravelDirection: true`).
- `space: 'world'` (default) treats path coordinates as world coordinates and compensates for the object's parent transform. `space: 'parent'` writes positions directly.
- `orientation: false` only moves the object. `positionOffset: [0, 2, 0]` adds a constant offset.
- The follower has no loop of its own. It does nothing until you call `update(dt)`.
- Events (`follower.on(type, fn)` returns an unsubscribe function; same on `PathCursor.events`):
  - `progress`, `waypoint`, `loop` and `complete` come from `update()`.
  - `play` and `pause` fire only when `isPlaying` actually changes, so a second `play()` emits nothing. Reaching the end with loop `'none'` emits `complete` and then `pause`, and `isPlaying` is already `false` inside both. `autoPlay` at construction doesn't emit `play`.
  - `reset` fires on every `reset()`, which keeps the play state. `play()` on a completed follower restarts it: `reset`, then `play`. Seeks (`setProgress`, `setDistance`, `setPath`) emit nothing.

### Speed and bank per waypoint

Every waypoint can carry a `speed` multiplier and a `roll` angle:

```json
"points": [
  { "position": [0, 20, 0] },
  { "position": [30, 30, -50], "speed": 0.6, "roll": 25 },
  { "position": [80, 50, -100], "speed": 1.5 }
]
```

- **speed** multiplies the follower's `speed` (so a route can be reused by faster or slower units). Missing = 1. Values are clamped to ≥ 0.01, so the follower never stalls. To stop at a point, use `onWaypoint` + `pause()`.
- **roll** banks the object around its travel direction, in degrees. Positive banks right (the right side goes down). Missing = 0. When travelling backwards (`pingpong`) the bank is mirrored, so the object still leans into the turn.
- Between waypoints the values blend according to `interpolation`: `'smooth'` (default, ease in/out), `'linear'`, or `'step'` (the value holds for the whole segment up to the next waypoint).

```ts
new PathFollower({
  object: helicopter, path, speed: 12,
  interpolation: 'smooth',            // 'linear' | 'step'
  useWaypointSpeed: true,             // default
  orientation: { applyRoll: true, rollScale: 1, smoothing: 6 },
});
follower.currentSpeed; // units/s right now
follower.currentRoll;  // degrees right now
path.getWaypointValueAtDistance('roll', d, 'smooth'); // sample without a follower
```

In the editor, select a point and fill in *Speed ×* / *Roll °* in the panel (leave the field empty for the default). Points with a roll show a yellow bar with the bank angle, and labels show `×speed ↻roll`.

Need the math without an Object3D? `PathCursor` (in `three-path-editor/core`) has the same progress/loop/event logic with no Three.js, and `path.getPointAt(u)` / `path.getTangentAt(u)` sample directly.

## Preview objects

```ts
const preview = editor.attachPreview(helicopter, 'helicopter-route', {
  speed: 15,
  loop: 'pingpong',
  orientation: { forward: [0, 0, -1] },
});
preview.pause(); preview.play(); preview.reset(); preview.speed = 30;
editor.previewPath('other-route');  // retarget the current preview
editor.detachPreview();             // restores the object's original position/rotation
editor.attachPreview();             // no object: an editor-owned arrow marker
```

Preview speed defaults to "traverse the path in about 10 s", so it works at any world scale.

### Keeping the previewed object in sync

Every change to the preview's playback emits an event, whatever caused it: the panel's Play/Pause/Reset/Stop buttons, your own calls, or a `loop: 'none'` path reaching its end. Use events for things like animation state instead of polling `preview.isPlaying` every frame:

```ts
// Editor level: any preview, including ones started from the panel.
editor.on('previewstate', ({ preview, playing }) => {
  if (preview.object === enemy.root) enemy.setAnimation(playing ? 'walk' : 'idle');
});

// Or per preview: the same events as PathFollower.on.
const preview = editor.attachPreview(enemy.root, 'patrol', {
  onPlay: () => enemy.setAnimation('walk'),
  onPause: () => enemy.setAnimation('idle'),
});
preview.on('reset', () => enemy.snapToStart());
```

- `previewstate` fires right after `preview` when an attached preview starts playing. A new preview autoplays, so the host doesn't need a separate "initial state" check.
- `detachPreview()` on a playing preview fires `previewstate` with `playing: false` (and the preview's own `pause`) before `preview` with `null`. A detached preview's listeners are removed.
- Listeners added with `preview.on()` survive `setPath` / `editor.previewPath()`.

## 2D paths

2D paths store `[x, y]` and live on a plane. The default is the XZ ground plane of Y-up scenes: path `[x, y]` → world `(x, 0, y)`.

```ts
import { createCoordinateSystem } from 'three-path-editor';

const coordinates = createCoordinateSystem({
  plane2D: 'xz',      // or 'xy' for side views / screen-space games
  elevation2D: 0.1,   // offset along the plane normal
  origin: [0, 0, 0],  // world position of the path origin
  scale: 1,           // path units → world units
});
const editor = new PathEditor({ scene, camera, renderer, coordinates });
const follower = new PathFollower({ object: car, path: groundLoop, coordinates, orientation: { yawOnly: true } });
```

Use the same coordinate system for the editor and all followers. For an unusual convention, implement the `CoordinateSystem` interface yourself. In the editor, the gizmo on 2D paths only shows the plane's two axes.

## 3D paths

3D paths store `[x, y, z]` world coordinates (after `origin`/`scale`) and use the full XYZ gizmo. Shift+click places new points on the horizontal plane through the selected point, so the altitude is kept. Drag the Y axis to change it.

## Production / runtime usage

A production game needs only the runtime entry:

```ts
import { getPathFromFile, PathFollower } from 'three-path-editor';
import routes from './paths/level1.paths.json';

const follower = new PathFollower({ object: enemy, path: getPathFromFile(routes, 'patrol-a'), speed: 4, loop: 'pingpong' });
```

| Entry | Contents | Three.js import |
| --- | --- | --- |
| `three-path-editor` | core + `PathFollower` | yes (`three` only) |
| `three-path-editor/core` | `Path`, curves, `PathCursor`, JSON, coordinates | **none** |
| `three-path-editor/editor` | everything above + `PathEditor`, panel, renderer, gizmos, `FlyControls` | yes (+ `TransformControls`) |
| `three-path-editor/vite` | `pathEditorSavePlugin` (Node, dev server) | **none** |

The package is ESM with `"sideEffects": false`. Editor code is only reachable from `/editor`, so a guarded dynamic import (`if (import.meta.env.DEV) await import('three-path-editor/editor')`) keeps it out of production bundles. At runtime `editor.disable()` removes everything from the scene and all listeners, and `editor.dispose()` also frees GPU resources.

## AI / Claude Code integration

The `skills/` folder is a Claude Code skill that tells Claude how to integrate this package into an existing project **without** creating duplicate scenes, renderers or loops:

- [skills/SKILL.md](skills/SKILL.md): detect the project, find scene/camera/renderer/loop, install, integrate, attach followers, disable for production, preserve architecture
- [skills/integration.md](skills/integration.md): patterns for plain Three.js, class-based engines, React Three Fiber, bundler guards
- [skills/routes.md](skills/routes.md): JSON format, file locations, authoring workflow, runtime loading
- [skills/troubleshooting.md](skills/troubleshooting.md): symptom → cause → fix

Install the skill into a project (non-destructive):

```bash
npx path-editor init        # copies skills/ to .claude/skills/three-path-editor/ and creates src/paths/example.paths.json
```

Then ask Claude Code something like *"Integrate three-path-editor into this game: edit routes in dev, make the helicopter follow `helicopter-route` in production."* The skill tells it to inspect the project first, run `npx path-editor doctor`, and make minimal changes.

## CLI

```bash
npx path-editor doctor          # report
npx path-editor doctor --json   # machine-readable
npx path-editor init [--dir src/paths] [--no-skill] [--dry-run]
```

`doctor` reports: Three.js version (declared/installed), package version, detected scene/camera/renderer/update loop/camera controls (with file:line), React Three Fiber, project structure, path JSON files (validated), unguarded editor imports, Claude skill status and overall integration status.

The CLI never overwrites or deletes files.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Nothing visible | `editor.enable()` and call `editor.update(dt)` every frame, with the scene/camera you actually render |
| Camera orbits while dragging | pass `cameraControls` |
| Clicks don't select | something covers the canvas: check the console warning / `inputblocked`, see [overlays](#html-overlays-covering-the-canvas) |
| Game shoots / reacts while editing | mute its input in `editor.on('enabled', ...)`, see [game input](#pausing-the-game-and-muting-its-input) |
| Can't look around, camera is on a rail | `FlyControls`, see [free camera](#a-free-camera-for-editing) |
| Edited curve differs from the game's | match `curve.parametrization` (e.g. `'centripetal'`) |
| Model faces the wrong way | set `orientation.forward` (e.g. `[1,0,0]`, `[0,0,-1]`) |
| Car pitches on hills | `orientation.yawOnly: true` |
| Editor in production bundle | dynamic import behind a dev guard |

Full list: [skills/troubleshooting.md](skills/troubleshooting.md).

## API overview

**Core** (`three-path-editor/core`, also re-exported from the root)

- `Path`: `waypoints`, `curve`, `dimension`, `metadata`, `length`, `version`, `events`
  - edit: `addWaypoint`, `removeWaypoint`, `moveWaypoint`, `reorderWaypoint`, `setWaypointHandles`, `setWaypointProperties`, `setMetadata`, `setWaypointMetadata`, `setCurve`, `reverse`, `markChanged`
  - sample: `getPointAt(u)`, `getTangentAt(u)`, `getPointAtDistance(d)`, `getTangentAtDistance(d)`, `getPoint(t)`, `sample(n)`, `getSpacedPoints(n)`, `getWaypointDistances()`, `getBezierHandles(i)`, `getWaypointValueAtDistance(key, d)`, `getClosestPoint(p)`
  - `toJSON()`, `Path.fromJSON()`, `clone()`
- `Waypoint`: `position`, `handleIn`, `handleOut`, `speed?`, `roll?`, `metadata`, `id?`
- `PathCursor`: engine-agnostic progress, speed, loop and events (`progress`, `waypoint`, `loop`, `complete`, `play`, `pause`, `reset`)
- `parsePathFile`, `readPathFile`, `getPathFromFile`, `serializePaths`, `stringifyPaths`, `PathFormatError`, `PATH_FORMAT_VERSION`
- `createCoordinateSystem`, `defaultCoordinateSystem`, `CoordinateSystem`
- Curves: `LinearCurve`, `CatmullRomCurve`, `BezierCurve`, `createCurve`, `ArcLengthTable`

**Runtime** (`three-path-editor`)

- `PathFollower`: `update`, `apply`, `play`, `pause`, `reset`, `setProgress`, `setDistance`, `setPath`, `on`, `speed`, `currentSpeed`, `currentRoll`, `loop`, `progress`, `distance`, `direction`, `isPlaying`, `isComplete`, `dispose`
- `Orienter` / `OrientationOptions`

**Editor** (`three-path-editor/editor`)

- `PathEditor`: `enable`, `disable`, `toggle`, `dispose`, `update`, `setCamera`, `createPath`, `createPathInView`, `loadPath`, `removePath`, `deleteSelectedPath`, `renamePath`, `import`, `export`, `exportString`, `select`, `clearSelection`, `addWaypoint`, `addWaypointAtScreen`, `insertWaypointAt`, `insertWaypointAtScreen`, `deleteSelectedWaypoint`, `removeWaypoint`, `moveWaypoint`, `reorderWaypoint`, `shiftSelectedWaypoint`, `undo`, `redo`, `canUndo`, `canRedo`, `history`, `setView`, `toggleView`, `attachPreview`, `previewPath`, `detachPreview`, `pick`, `setRayFromScreen`, `getViewCenter`, `can`, `applyConstraints`, `saveSession`, `restoreSession`, `on`, `root`, `state`, `placement`, `constrainWaypoint`
  - options beyond the basics: `diagnostics`, `restoreCameraOnDisable`, `canEdit`, `constrainWaypoint`
  - events: `change`, `select`, `view`, `pathadded`, `pathremoved`, `import`, `dragstart`, `dragend`, `enabled`, `preview`, `history`, `inputblocked`, `denied`
- `PathEditorPanel`: optional DOM UI (`onSave`, `onExport`, `formatWaypoint`, ...)
- `FlyControls`: optional free-fly camera (`enabled`, `update`, `speed`, `keys`, `dispose`)
- `saveToDevServer(json, { endpoint })`
- `PathPreview`: `play`, `pause`, `toggle`, `reset`, `setProgress`, `setPath`, `detach`
- `ThreePathRenderer`: renders a single path (usable without the editor for debug views)
- `planePlacement`, `objectPlacement`, `PlacementProvider`, `surfaceConstraint`, `WaypointConstraint`

**Vite plugin** (`three-path-editor/vite`, Node, dev server only)

- `pathEditorSavePlugin({ file, endpoint?, indent?, maxBytes?, writeFile? })`
- `EditorState`, `EditorHistory`, `insertWaypointAfter`, `insertWaypointAtT`, `suggestWaypointPosition`, `shiftWaypoint`, `bindShortcuts`

## Development

```bash
npm install          # also builds dist/ via `prepare`
npm run demo         # local Three.js demo (Vite) at http://localhost:5173
npm test             # vitest
npm run typecheck    # tsc --noEmit
npm run build        # tsup → dist/ (ESM + .d.ts)
npm run doctor       # run the CLI against this repo
```

Layout:

```
src/
  core/       Path, Waypoint, curves, arc length, PathCursor, coordinates, serialization (no three)
  runtime/    PathFollower, orientation (three)
  editor/     EditorState, point operations, keyboard shortcuts (no three)
  three/      PathEditor, ThreePathRenderer, PathPreview, PathEditorPanel, placement (three)
  utils/      vec3 math, emitter, ids
bin/          path-editor CLI (plain Node, no deps)
skills/       Claude Code skill
examples/demo Vite demo (for testing the package only)
tests/        vitest suites
```

## License

MIT (see [LICENSE](LICENSE); fill in the copyright holder before publishing).
