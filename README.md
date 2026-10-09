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
- [Markers](#markers-a-single-named-place)
- [Facings](#facings-a-heading-per-waypoint)
- [Authored times and camera rigs](#authored-times-and-camera-rigs)
- [PathFollower](#pathfollower)
- [Preview objects](#preview-objects)
- [Visuals: dressing a model's mesh sets](#visuals-dressing-a-models-mesh-sets)
- [2D paths](#2d-paths) · [3D paths](#3d-paths)
- [Production / runtime usage](#production--runtime-usage)
- [AI / Claude Code integration](#ai--claude-code-integration)
- [CLI](#cli)
- [Troubleshooting](#troubleshooting)
- [API overview](#api-overview)
- [Releasing into a creative](#releasing-into-a-creative-vendored-tarball)
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

Or let the editor take the screen for the session:

```ts
new PathEditor({ ..., isolateUi: true });
```

`isolateUi` hides and blocks every element on the page except the viewport (`domElement`, marked `data-path-editor-viewport` while enabled) and anything marked `data-path-editor-ui`. It uses `visibility`, not `display`, so the game's layout keeps its size and comes back untouched on `disable()`.

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

### Your own gizmos and controls in the same scene

The editor's pointer handler sits on `window` in the capture phase, so it can claim a press before `TransformControls` or the camera controls see it. Three hooks keep a host gizmo and the editor out of each other's way:

```ts
new PathEditor({
  ...,
  otherControls: [myYawGizmo],            // anything with an `axis`
  claimPointer: (e) => myWidget.hitTest(e),
});
editor.gizmoEngaged; // true while any gizmo owns the pointer
editor.gizmo;        // the editor's own gizmo (`axis`, `dragging`), read-only use
```

- `otherControls` — while one of them reports an `axis` (or `dragging`), the editor leaves the press alone: it neither selects nor clears the selection, so clicking your gizmo no longer deselects the point it belongs to.
- `claimPointer` — called first for every press in the viewport. Return true and the editor ignores that press entirely and lets it through to you.

Camera controls have **one** owner: the editor. A gizmo of your own must not write `cameraControls.enabled` — two gizmos doing that on one press leave the camera switched off forever. Ask the editor instead:

```ts
const release = editor.suspendCameraControls(); // counted; nest as deep as you like
release();                                      // the last release restores what the controls had
```

### A camera the game drives

`restoreCameraOnDisable` puts the camera back where the game had it. A camera parented into a rig also has to leave that rig to be orbited at all — `detachCamera: true` moves it into the scene for the session, keeping its world pose, and puts it back on `disable()` (it implies `restoreCameraOnDisable`).

Bare `OrbitControls` scale zoom and pan by the distance to `target`, so both stall as you approach a fixed pivot. `pivotUnderPointer` keeps the pivot on the surface under the pointer, at that depth along the view axis so the view never jumps:

```ts
new PathEditor({
  ...,
  cameraControls: orbit,
  detachCamera: true,
  pivotUnderPointer: { objects: () => [map], minDistance: 1.5 },
});
```

`objects` defaults to the whole scene minus the editor's own objects, and the pivot moves on pointer presses and wheel events, before the controls handle them.

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
- The camera moves in its parent's space. If your rig parents the camera to a moving object, use `detachCamera: true` (see above) or have your `enabled` handler stop the rig from driving it.
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

### Routes authored on a surface: `linearHeight`

A spline through points on a floor overshoots in height where a flat stretch
runs into a climb, so the curve dips below the floor the points sit on (half a
metre at a stair flight is normal). `linearHeight` interpolates height linearly
between waypoints while x/z keep following the curve, so a segment can never
leave the span between the heights of its two waypoints:

```json
"curve": { "type": "catmull-rom", "parametrization": "centripetal", "linearHeight": true }
```

3D paths with a curved type only; it is ignored for 2D and `'linear'` paths.

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
| Facing / time of a waypoint | panel: *Yaw °*, *Time*, or the rotate gizmo (`R`) | `path.setWaypointProperties(i, { yaw, time })` |
| New marker (a single named place) | panel: **+ Marker** | `editor.createMarker({ id, position, yaw })` |
| Delete whole path | panel: **Delete path** (asks for confirmation) | `editor.deleteSelectedPath()` / `editor.removePath(id)` |
| Delete waypoint | `Delete` / `Backspace` | `editor.deleteSelectedWaypoint()` |
| Reorder waypoint | `Alt+[` / `Alt+]` | `editor.reorderWaypoint(pathId, from, to)` |
| Prev / next waypoint | `[` / `]` | `editor.selectAdjacentWaypoint(±1)` |
| Deselect | `Escape`, click empty space | `editor.clearWaypointSelection()` |
| Toggle gizmos | `G` | `editor.toggleView('gizmos')` |
| Gizmo: move / turn the point | `R` | `editor.toggleGizmoMode()` / `setGizmoMode('rotate')` |
| Undo / redo | **Cmd/Ctrl+Z** / **Cmd/Ctrl+Shift+Z** (or Ctrl+Y), panel ↶ ↷ | `editor.undo()` / `editor.redo()` |
| Toggle path / arrows / labels / facings / sight lines / below-floor / grid / debug | panel | `editor.setView({ paths, directions, labels, facings, sightlines, surface, grid, debug })` |
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
- Optional per-point `yaw` (facing in degrees for something standing there) and `time` (authored time in your own units). See [Facings](#facings-a-heading-per-waypoint) and [Authored times](#authored-times-and-camera-rigs).
- `kind: "marker"` marks a path that is one named place rather than a route. See [Markers](#markers-a-single-named-place).
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

## Markers: a single named place

A spawn point, a prop, a light — something an object just stands on, with no route to travel. `editor.createMarker()` (panel: **+ Marker**) makes a path with `kind: 'marker'`: one waypoint, no curve settings, and the editor refuses to add more points to it.

```ts
const spawn = editor.createMarker({ id: 'guard-spawn', position: [12, 0, -4], yaw: 90 });
editor.markers;   // markers only
editor.routes;    // everything that is not a marker
editor.paths;     // both — markers live in the same file, selection, history and JSON
```

A marker is a `Path`, so it is selected, moved, turned, undone and saved exactly like a route, and the game reads it the same way: `getPathFromFile(routes, 'guard-spawn').waypoints[0]`.

## Facings: a heading per waypoint

Routes answer "where", not "which way is it facing" — a guard standing on a point, a prop, a turret. Press `R` (or `editor.setGizmoMode('rotate')`) and the gizmo turns the selected point instead of moving it, writing `yaw` in degrees around the path's up axis. Points that carry one show a facing arrow (view toggle **Facings**).

```ts
path.setWaypointProperties(0, { yaw: -135 });   // or the panel's Yaw ° field
const heading = path.waypoints[0].yaw;          // degrees, undefined when not authored
```

Travel ignores `yaw`: a follower takes its heading from the curve. It is there for whatever stands still. To put an object on it at runtime, use `PathFollower.setYaw((yaw * Math.PI) / 180)` or build the rotation with `Orienter.yawTo`.

## Authored times and camera rigs

Two paths cannot be kept in step by waypoint index: point N of a camera path has nothing to do with point N of what it looks at. Author `time` on the points instead (panel: *Time*, any unit you like), and both paths can be sampled at the same time:

```ts
camera.getPointAtTime(2.5);      // interpolated between the timed waypoints
camera.distanceAtTime(2.5);      // and back: timeAtDistance(d)
camera.timeRange;                // { start, end } or null
camera.duration;
follower.setTime(2.5);           // seek a follower by authored time
```

A **camera rig** pairs the two paths:

```ts
const rig = editor.addRig({ path: 'phase1-camera', lookAt: 'phase1-camera-target', duration: 6 });
editor.playRig(rig);   // flies the editor's camera along it, looking at the matching point
editor.stopRig();      // and puts the camera back
```

- Sight lines between the matching points are drawn in the view (toggle **Sight lines**), so the framing is visible while editing instead of only after restarting the game.
- The rig samples by authored `time` when both paths carry one, by normalized arc length otherwise.
- The flight suspends the host's camera controls, restores the camera pose when it ends or is stopped, and reports `rigstate: { rig, playing }`. The panel shows a **Fly** button when rigs exist.

## Warning where a path sinks into the floor

Pass the floors and the editor ticks every span of a curve that runs below them (view toggle **Below floor**) — the sag a spline makes where a flat stretch meets a climb, which `curve.linearHeight` removes:

```ts
new PathEditor({ ..., surface: () => [map] });
new PathEditor({ ..., surface: { objects: [map], tolerance: 0.05 } });
editor.surfaceWarnings;   // the SurfaceCheck, to restyle or re-check
```

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
  startFrom: 'path',      // 'path' (default) | 'closest' | 'object' (lead-in leg)
  initialRotation: 'path', // 'path' (default) | 'object' (ease from where it faces now)
  onWaypoint: ({ index, waypoint, distance }) => {},
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
follower.setWaypoint('gate');                          // by index or metadata.name
follower.setWaypoint('gate', { emitWaypoints: true }); // let listeners hear the skipped points
follower.hasPassed('gate');
follower.once('waypoint', run, (e) => e.waypoint.metadata.name === 'gate');
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
  - `reset` fires on every `reset()`, which keeps the play state. `play()` on a completed follower restarts it: `reset`, then `play`. Seeks (`setProgress`, `setDistance`, `setWaypoint`, `setPath`) emit nothing — a seek is a cut, not travel. Pass `{ emitWaypoints: true }` to a seek and the waypoints it passed over are emitted in travel order, so code waiting for a point isn't left hanging.
  - `waypoint` carries the `waypoint` itself and its `distance`, so a listener can match on `metadata.name` without resolving indices. `once(type, fn, filter?)` unsubscribes after the first event the filter accepts, and `hasPassed(index | name)` answers whether a point is already behind the cursor in the current travel direction.
  - `enter` is the follower's own event: the lead-in leg of `startFrom: 'object'` reached the path.
- Sampling allocates nothing: `getPointAtDistance(d, out)` and every other evaluator write into a vector you own, and the follower reuses its own.

### Starting somewhere other than the first waypoint

`startFrom` decides where a follower begins:

- `'path'` (default) — at `startProgress`.
- `'closest'` — at the point on the path nearest the object's current position. For a route picked up mid-scene, so nothing teleports.
- `'object'` — the object stays where it stands and runs a straight lead-in leg onto the path at the speed the path opens with, facing along it; `enter` fires on arrival and `isEntering` is true until then. Travel along the path then starts at `startProgress`.

With `smoothing`, the first frame normally snaps onto the path's heading, because the follower has no previous rotation to ease from. `initialRotation: 'object'` eases from the rotation the object already has; `follower.seedRotation(q)` does the same at any time.

### Heading: read `follower.yaw`, not `rotation.y`

The follower writes rotations as quaternions. An XYZ Euler cannot hold a yaw past ±90°, so `object.rotation.y` comes back mirrored with `x`/`z` flipped by 180° — and code that then writes `rotation.y` silently breaks the heading. `follower.yaw` (radians around the orientation's world up) and `follower.setYaw(yaw)` are exact in both directions, and `setYaw` also seeds the smoothing, so a scripted turn eases on from it. `Orienter.yawOf(q)` / `yawTo(yaw, q)` do the same without a follower.

### Several objects on one path: riders

A convoy, a flock or a camera trailing a vehicle doesn't need a follower each. Riders share the leader's cursor, so speed, loops and events are integrated once:

```ts
const car = follower.addRider({ object: trailer, offset: 6 });          // 6 units behind
const wing = follower.addRider({ object: bird, offset: 3, lateral: [2, 1] }); // right 2, up 1
follower.removeRider(wing);
```

`offset` is measured along the path against the direction of travel (negative = ahead), clamped at the ends of an open path and wrapped on a looping one. `lateral` is `[right, up]` in world units, in the frame of the rider's own position. A rider takes the leader's orientation settings unless given its own (`orientation: false` only moves it).

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

## Visuals: dressing a model's mesh sets

A model often carries more than it wears: one character rig with four head
covers, one car with three bumpers. A **mesh set** is one named mesh on an
object; a **visuals file** records which sets each object draws. The editor's
**Visuals tab** authors that file, dressing the live objects as you tick them.

**The tab is there as soon as the editor is.** With nothing configured it
reads the scene for objects carrying more than one named mesh, and when there
is nothing to dress it says so in the tab itself, naming the skill that sets
visuals up and the model the meshes should come from. Point it at your own
objects when you have them:

```ts
const panel = new PathEditorPanel(editor, {
  visuals: {
    subjects: () => cast.map((unit) => ({ id: unit.role, object: unit.root })),
    data: visualsFile,                                // null / undefined is fine
    file: 'src/visuals/characters.visuals.json',
    source: 'Characters.glb',
    exclusive: [['Helm001', 'Bandana', 'Bandana_2']], // at most one head cover
    onSave: (json) => saveToDevServer(json, { endpoint: DEFAULT_VISUALS_SAVE_ENDPOINT }),
  },
});
```

`visuals: false` leaves the tab out; `panel.visuals` is the `VisualsEditor`
behind it. `panel.addTab({ label, element })` puts any other host panel behind
a tab of the same frame.

**Nothing here throws.** No visuals file yet, a cast that is not built, a file
written against an older model — each is reported inside the tab, with the one
line that fixes it. Whatever can be dressed still is.

`npx path-editor meshes <model.glb>` lists the sets a model carries, named the
way `GLTFLoader` will hold them.

In production the game dresses its own objects, with no editor code:

```ts
import { applyVisuals, readVisualsFile, wornOf } from 'three-path-editor';

const file = readVisualsFile(data);
applyVisuals(unit.root, wornOf(file, unit.role) ?? []);
```

See [skills/visuals/SKILL.md](skills/visuals/SKILL.md) for the full setup.

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
- [skills/visuals/SKILL.md](skills/visuals/SKILL.md): a second skill — set up the Visuals tab, the visuals file and runtime dressing

Install the skill into a project (non-destructive):

```bash
npx path-editor init        # copies both skills to .claude/skills/ and creates src/paths/example.paths.json
```

Then ask Claude Code something like *"Integrate three-path-editor into this game: edit routes in dev, make the helicopter follow `helicopter-route` in production."* The skill tells it to inspect the project first, run `npx path-editor doctor`, and make minimal changes.

## CLI

```bash
npx path-editor doctor          # report
npx path-editor doctor --json   # machine-readable
npx path-editor init [--dir src/paths] [--no-skill] [--dry-run]
npx path-editor meshes <model.glb> [--json]   # mesh sets for the Visuals tab
```

`doctor` reports: Three.js version (declared/installed), package version, detected scene/camera/renderer/update loop/camera controls (with file:line), React Three Fiber, project structure, path JSON files (validated), unguarded editor imports, Claude skill status and overall integration status.

The CLI never overwrites or deletes files.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Nothing visible | `editor.enable()` and call `editor.update(dt)` every frame, with the scene/camera you actually render |
| Camera orbits while dragging | pass `cameraControls` |
| Camera stays dead after a drag | a host gizmo wrote `cameraControls.enabled`; use `editor.suspendCameraControls()` |
| Gizmo stops grabbing presses after toggling the editor | fixed: `disable()` now ends a drag in progress |
| Clicking a host gizmo clears the selection | `otherControls: [hostGizmo]` or `claimPointer` |
| Game UI covers the canvas while editing | `isolateUi: true` |
| Panel stays on screen when the editor is off | `new PathEditorPanel(editor, { hideWhenDisabled: true })` |
| Camera can't be orbited (it sits in a rig) | `detachCamera: true` |
| Zoom and pan stall near the pivot | `pivotUnderPointer: true` |
| Clicks don't select | something covers the canvas: check the console warning / `inputblocked`, see [overlays](#html-overlays-covering-the-canvas) |
| Game shoots / reacts while editing | mute its input in `editor.on('enabled', ...)`, see [game input](#pausing-the-game-and-muting-its-input) |
| Can't look around, camera is on a rail | `FlyControls`, see [free camera](#a-free-camera-for-editing) |
| Edited curve differs from the game's | match `curve.parametrization` (e.g. `'centripetal'`) |
| Model faces the wrong way | set `orientation.forward` (e.g. `[1,0,0]`, `[0,0,-1]`) |
| Car pitches on hills | `orientation.yawOnly: true` |
| Route dips below the floor between points | `curve.linearHeight: true`, and `surface:` to see where |
| Need a facing, not a route | the rotate gizmo (`R`) writes the waypoint's `yaw` |
| Need a single point, not a path | `editor.createMarker()` |
| Camera path and its target drift apart | author `time` on both and pair them with `addRig` |
| Object teleports to the first waypoint | `startFrom: 'closest'` or `'object'` |
| First frame snaps the object's heading around | `initialRotation: 'object'` (or `seedRotation`) |
| `rotation.y` is wrong past ±90° | read `follower.yaw`, write `follower.setYaw()` |
| A convoy or flock needs one follower each | `follower.addRider({ object, offset, lateral })` |
| Editor in production bundle | dynamic import behind a dev guard |

Full list: [skills/troubleshooting.md](skills/troubleshooting.md).

## API overview

**Core** (`three-path-editor/core`, also re-exported from the root)

- `Path`: `waypoints`, `curve`, `dimension`, `metadata`, `length`, `version`, `events`
  - edit: `addWaypoint`, `removeWaypoint`, `moveWaypoint`, `reorderWaypoint`, `setWaypointHandles`, `setWaypointProperties`, `setMetadata`, `setWaypointMetadata`, `setCurve`, `reverse`, `markChanged`
  - sample (every evaluator takes an optional `out` vector and writes into it): `getPointAt(u, out?)`, `getTangentAt(u, out?)`, `getPointAtDistance(d, out?)`, `getTangentAtDistance(d, out?)`, `getPoint(t, out?)`, `sample(n)`, `getSpacedPoints(n)`, `getWaypointDistances()`, `getBezierHandles(i)`, `getWaypointValueAtDistance(key, d)`, `getClosestPoint(p)`
  - look up: `indexOfWaypoint(name | predicate)`, `distanceOfWaypoint(index | name)`
  - authored time: `timeRange`, `duration`, `distanceAtTime(t)`, `timeAtDistance(d)`, `getPointAtTime(t, out?)`, `getTangentAtTime(t, out?)`
  - `kind` / `isMarker`: a single named place instead of a route
  - `toJSON()`, `Path.fromJSON()`, `clone()`
- `Waypoint`: `position`, `handleIn`, `handleOut`, `speed?`, `roll?`, `yaw?`, `time?`, `metadata`, `id?`
- `PathCursor`: engine-agnostic progress, speed, loop and events (`progress`, `waypoint`, `loop`, `complete`, `play`, `pause`, `reset`), plus `seek(d, opts)`, `seekProgress(u, opts)`, `seekWaypoint(index | name, opts)`, `hasPassed(index | name)`
- `parsePathFile`, `readPathFile`, `getPathFromFile`, `serializePaths`, `stringifyPaths`, `PathFormatError`, `PATH_FORMAT_VERSION`
- `createCoordinateSystem`, `defaultCoordinateSystem`, `CoordinateSystem`
- Curves: `LinearCurve`, `CatmullRomCurve`, `BezierCurve`, `LinearHeightCurve`, `createCurve`, `ArcLengthTable`

**Runtime** (`three-path-editor`)

- `PathFollower`: `update`, `apply`, `play`, `pause`, `reset`, `setProgress`, `setDistance`, `setWaypoint`, `setPath`, `hasPassed`, `on`, `once`, `yaw`, `setYaw`, `seedRotation`, `addRider`, `removeRider`, `riders`, `isEntering`, `speed`, `currentSpeed`, `currentRoll`, `loop`, `progress`, `distance`, `direction`, `isPlaying`, `isComplete`, `dispose`
- `FollowerRider` / `RiderOptions`: an object carried along the leader's path at an offset
- `Orienter` / `OrientationOptions`: `compute`, `yawOf`, `yawTo`, `worldUp`

**Editor** (`three-path-editor/editor`)

- `PathEditor`: `enable`, `disable`, `toggle`, `dispose`, `update`, `setCamera`, `createPath`, `createPathInView`, `loadPath`, `removePath`, `deleteSelectedPath`, `renamePath`, `import`, `export`, `exportString`, `select`, `clearSelection`, `addWaypoint`, `addWaypointAtScreen`, `insertWaypointAt`, `insertWaypointAtScreen`, `deleteSelectedWaypoint`, `removeWaypoint`, `moveWaypoint`, `reorderWaypoint`, `shiftSelectedWaypoint`, `undo`, `redo`, `canUndo`, `canRedo`, `history`, `setView`, `toggleView`, `attachPreview`, `previewPath`, `detachPreview`, `pick`, `setRayFromScreen`, `getViewCenter`, `can`, `applyConstraints`, `saveSession`, `restoreSession`, `on`, `root`, `state`, `placement`, `constrainWaypoint`
  - also: `suspendCameraControls`, `gizmoEngaged`, `gizmo`, `gizmoMode`, `setGizmoMode`, `toggleGizmoMode`, `createMarker`, `markers`, `routes`, `addRig`, `removeRig`, `rigs`, `getRig`, `playRig`, `stopRig`, `flyingRig`, `surfaceWarnings`, `otherControls`, `claimPointer`
  - options beyond the basics: `diagnostics`, `restoreCameraOnDisable`, `detachCamera`, `isolateUi`, `pivotUnderPointer`, `otherControls`, `claimPointer`, `gizmoMode`, `rigs`, `surface`, `canEdit`, `constrainWaypoint`
  - events: `change`, `select`, `view`, `pathadded`, `pathremoved`, `import`, `dragstart`, `dragend`, `enabled`, `preview`, `previewstate`, `history`, `inputblocked`, `denied`, `waypointremoved`, `gizmomode`, `rigstate`
- `PathEditorPanel`: optional DOM UI (`onSave`, `onExport`, `formatWaypoint`, `hideWhenDisabled`, `setVisible`, ...)
- `FlyControls`: optional free-fly camera (`enabled`, `update`, `speed`, `keys`, `dispose`)
- `saveToDevServer(json, { endpoint })`
- `PathPreview`: `play`, `pause`, `toggle`, `reset`, `setProgress`, `setPath`, `detach`
- `CameraRig`: a camera path paired with what it looks at (`sample`, `lines`, `timed`, `flightTime`)
- `SurfaceCheck`: ticks the spans of a path that run below a surface (`lines`, `update`)
- `ThreePathRenderer`: renders a single path (usable without the editor for debug views)
- `planePlacement`, `objectPlacement`, `PlacementProvider`, `surfaceConstraint`, `WaypointConstraint`, `isEditorObject`

**Vite plugin** (`three-path-editor/vite`, Node, dev server only)

- `pathEditorSavePlugin({ file, endpoint?, indent?, maxBytes?, writeFile? })`
- `EditorState`, `EditorHistory`, `insertWaypointAfter`, `insertWaypointAtT`, `suggestWaypointPosition`, `shiftWaypoint`, `bindShortcuts`

## Releasing into a creative (vendored tarball)

Platforms that build an uploaded zip run `npm install` with no access to a private registry. The package travels inside the creative instead: `npm pack` produces `three-path-editor-<version>.tgz`, the file sits in the creative's `vendor/` folder, and its package.json points at it.

```json
"three-path-editor": "file:vendor/three-path-editor-0.4.0.tgz"
```

`npm i` unpacks that tarball into `node_modules` and records the path and its integrity hash in `package-lock.json`. The packer puts `vendor/` into the uploaded zip, so the platform's `npm install` finds the file next to the manifest. The tarball carries a prebuilt `dist` (npm does not run `prepare` for a tarball dependency), so the platform needs none of this package's dev dependencies.

One command does the whole round trip:

```bash
npm run release:vendor -- ../my-creative --bump minor --prune
```

It runs `npm test` and `npm run typecheck`, bumps the version (`npm version`, which commits and tags), packs — `npm pack` runs `prepare`, so `dist` is always fresh — drops the tarball into `../my-creative/vendor/`, rewrites the dependency line, deletes the previous tarball with `--prune`, and warns if `vendor/` is in the creative's `.gitignore`.

```
--bump <patch|minor|major|x.y.z>  bump this package's version first
--no-tag                          bump without a git commit and tag
--skip-tests                      don't run `npm test` and `npm run typecheck`
--prune                           delete older tarballs of this package from vendor/
--vendor <dir>                    vendor folder inside the creative (default: vendor)
--install                         run `npm install` in the creative afterwards
--dry-run                         report what would happen, change nothing
```

Then, in the creative: `npm i` (which updates `package-lock.json`) and `npm run build`, and reupload.

What bites:

- **Bump the version every time.** The tarball's name carries it; reusing a name can leave npm with the previous unpacked copy. If you must repack the same version: `rm -rf node_modules/three-path-editor && npm i --force`.
- **Commit the creative's `package-lock.json` together with the tarball.** The lock holds the file path; if it names a tarball that is no longer there, `npm ci` on the platform fails with `ENOENT`.
- `three` is a peer dependency — the creative installs its own, r150 or newer.
- Production code imports `three-path-editor`, not `/editor` (see [Production / runtime usage](#production--runtime-usage)); the editor entry pulls in the panel, the gizmos and `three/examples/jsm`.

## Development

```bash
npm install          # also builds dist/ via `prepare`
npm run demo         # local Three.js demo (Vite) at http://localhost:5173
npm test             # vitest
npm run typecheck    # tsc --noEmit
npm run build        # tsup → dist/ (ESM + .d.ts)
npm run doctor       # run the CLI against this repo
npm run release:vendor -- <creative-dir> [--bump minor] [--prune]
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
scripts/      release-vendor.mjs: pack into a creative's vendor/ (plain Node, no deps)
skills/       Claude Code skill
examples/demo Vite demo (for testing the package only)
tests/        vitest suites
```

## License

MIT (see [LICENSE](LICENSE); fill in the copyright holder before publishing).
