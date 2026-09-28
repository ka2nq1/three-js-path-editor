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

Editor events: `change`, `select`, `view`, `pathadded`, `pathremoved`, `import`, `dragstart`, `dragend`, `enabled`, `preview`, `history`:

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
| `three-path-editor/editor` | everything above + `PathEditor`, panel, renderer, gizmos | yes (+ `TransformControls`) |

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
| Clicks don't select | pass the element that receives pointer events as `domElement` |
| Model faces the wrong way | set `orientation.forward` (e.g. `[1,0,0]`, `[0,0,-1]`) |
| Car pitches on hills | `orientation.yawOnly: true` |
| Editor in production bundle | dynamic import behind a dev guard |

Full list: [skills/troubleshooting.md](skills/troubleshooting.md).

## API overview

**Core** (`three-path-editor/core`, also re-exported from the root)

- `Path`: `waypoints`, `curve`, `dimension`, `metadata`, `length`, `version`, `events`
  - edit: `addWaypoint`, `removeWaypoint`, `moveWaypoint`, `reorderWaypoint`, `setWaypointHandles`, `setWaypointProperties`, `setCurve`, `reverse`, `markChanged`
  - sample: `getPointAt(u)`, `getTangentAt(u)`, `getPointAtDistance(d)`, `getTangentAtDistance(d)`, `getPoint(t)`, `sample(n)`, `getSpacedPoints(n)`, `getWaypointDistances()`, `getBezierHandles(i)`, `getWaypointValueAtDistance(key, d)`, `getClosestPoint(p)`
  - `toJSON()`, `Path.fromJSON()`, `clone()`
- `Waypoint`: `position`, `handleIn`, `handleOut`, `speed?`, `roll?`, `metadata`, `id?`
- `PathCursor`: engine-agnostic progress, speed, loop and events
- `parsePathFile`, `readPathFile`, `getPathFromFile`, `serializePaths`, `stringifyPaths`, `PathFormatError`, `PATH_FORMAT_VERSION`
- `createCoordinateSystem`, `defaultCoordinateSystem`, `CoordinateSystem`
- Curves: `LinearCurve`, `CatmullRomCurve`, `BezierCurve`, `createCurve`, `ArcLengthTable`

**Runtime** (`three-path-editor`)

- `PathFollower`: `update`, `apply`, `play`, `pause`, `reset`, `setProgress`, `setDistance`, `setPath`, `on`, `speed`, `currentSpeed`, `currentRoll`, `loop`, `progress`, `distance`, `direction`, `isPlaying`, `isComplete`, `dispose`
- `Orienter` / `OrientationOptions`

**Editor** (`three-path-editor/editor`)

- `PathEditor`: `enable`, `disable`, `toggle`, `dispose`, `update`, `setCamera`, `createPath`, `createPathInView`, `loadPath`, `removePath`, `deleteSelectedPath`, `renamePath`, `import`, `export`, `exportString`, `select`, `clearSelection`, `addWaypoint`, `addWaypointAtScreen`, `insertWaypointAt`, `insertWaypointAtScreen`, `deleteSelectedWaypoint`, `removeWaypoint`, `moveWaypoint`, `reorderWaypoint`, `shiftSelectedWaypoint`, `undo`, `redo`, `canUndo`, `canRedo`, `history`, `setView`, `toggleView`, `attachPreview`, `previewPath`, `detachPreview`, `pick`, `setRayFromScreen`, `getViewCenter`, `on`, `root`, `state`, `placement`
- `PathEditorPanel`: optional DOM UI
- `PathPreview`: `play`, `pause`, `toggle`, `reset`, `setProgress`, `setPath`, `detach`
- `ThreePathRenderer`: renders a single path (usable without the editor for debug views)
- `planePlacement`, `objectPlacement`, `PlacementProvider`
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
