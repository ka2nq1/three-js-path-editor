# Routes (path JSON files)

## Format (version 1)

```json
{
  "version": 1,
  "paths": [
    {
      "id": "helicopter-route",
      "name": "Helicopter route",
      "dimension": 3,
      "curve": { "type": "catmull-rom", "closed": false, "tension": 0.5 },
      "points": [
        { "position": [0, 20, 0] },
        { "position": [30, 30, -50], "speed": 0.6, "roll": 25, "metadata": { "wait": 2 } },
        { "position": [80, 50, -100] }
      ],
      "metadata": {}
    }
  ]
}
```

| Field | Notes |
| --- | --- |
| `version` | Format version. Files newer than the installed package are rejected with a clear error. |
| `paths[].id` | Unique per file. Game code looks paths up by id. |
| `paths[].kind` | `"marker"` for a single named place (one point, no curve); omitted for routes. |
| `paths[].dimension` | `2` → positions are `[x, y]`; `3` → `[x, y, z]`. |
| `curve.type` | `"linear"`, `"catmull-rom"` or `"bezier"`. |
| `curve.closed` | Loop back to the first point. |
| `curve.tension` | Catmull-Rom tension (0.5 = classic). Also shapes auto Bezier handles. |
| `curve.parametrization` | Catmull-Rom knot spacing: `"uniform"` (default), `"centripetal"`, `"chordal"`. Same meaning as `THREE.CatmullRomCurve3`'s curveType. Only written when set. |
| `curve.linearHeight` | 3D curved paths only: interpolate height linearly between points so a segment cannot dip below the floor the points sit on. Only written when set. |
| `points[].speed` | Speed multiplier at this point (default 1). Blended between points by the follower's `interpolation`. |
| `points[].roll` | Bank angle in degrees (default 0, positive = bank right). Applied around the travel direction. |
| `points[].yaw` | Facing in degrees around the up axis for an object standing on this point. Travel ignores it. |
| `points[].time` | Authored time at this point, in the host's units. Two paths with the same times can be sampled at the same time (`Path.getPointAtTime`). |
| `points[].handleIn/handleOut` | Bezier only, **relative** to the point. Missing = automatic smooth handles. |
| `metadata` | Any JSON, on paths and points. Preserved on import/export. |
| any other key | Preserved on import/export (file, path and point level). |

The parser also accepts a single path object or a bare array of paths.

## Where to keep route files

Match the project's asset conventions. Typical choices:

- `src/paths/<level>.paths.json`, imported with `import routes from './paths/level1.paths.json'`. Bundled, available synchronously, works for single-file builds. **Preferred.**
- `public/paths/*.json`, loaded with `fetch()`. Can be swapped without a rebuild.
- Inside an existing level/config file: store the path file object under a key and pass that object to `parsePathFile`.

Use one file per level/scene, with several paths inside.

## Authoring workflow

1. Run the game in dev mode with the editor enabled.
2. Load the existing file: `editor.import(routes)`, or use the panel's **Import…** button.
3. Create or edit paths: **+ 3D path** / **+ 2D path**, Shift+click empty space to add points, Shift+click or double-click the line to insert a point on the curve, drag the gizmos. Set *Speed ×* / *Roll °* per point in the panel. **Delete path** removes a whole path.
4. Set a meaningful **Id** in the panel. This is what game code references.
5. Preview with **Preview path**, or `editor.attachPreview(gameObject, id)`.
6. Click **Export** (downloads `paths.json`) or **Copy**, and save the result over the file in the project.
7. Commit the JSON.

Programmatically: `editor.exportString()` returns the JSON text, and `editor.export()` returns the object.

## Loading at runtime (no editor code)

```ts
import { parsePathFile, getPathFromFile, readPathFile } from 'three-path-editor';

const paths = parsePathFile(routesJson);                 // Path[]
const route = getPathFromFile(routesJson, 'patrol-a');   // throws PathFormatError if missing
const file = readPathFile(routesJson);                   // { version, paths, extras }
```

## Following a route

```ts
import { PathFollower } from 'three-path-editor';

const follower = new PathFollower({
  object: enemy,                 // any Object3D
  path: route,
  speed: 4,                      // units per second (constant along the curve)
  loop: 'pingpong',              // false | true | 'loop' | 'pingpong'
  orientation: { forward: [0, 0, 1], yawOnly: true, smoothing: 8 },
  onWaypoint: ({ index }) => {
    const wait = route.waypoints[index].metadata.wait;
    if (typeof wait === 'number') { follower.pause(); setTimeout(() => follower.play(), wait * 1000); }
  },
  onComplete: () => enemy.userData.arrived = true,
});

// existing loop
follower.update(dt);
```

Per-waypoint `speed`/`roll` are applied automatically. Tune with `interpolation: 'smooth' | 'linear' | 'step'`, `useWaypointSpeed: false`, `orientation: { applyRoll: false, rollScale: 0.5 }`. Read the live values from `follower.currentSpeed` / `follower.currentRoll`.

Other controls: `play()`, `pause()`, `reset()`, `setProgress(0..1)`, `setDistance(d)`, `speed`, `loop`, `progress`, `distance`, `isComplete`, `speedModifier = ({ progress }) => multiplier`.

Sampling without a follower (e.g. for your own movement code or projectiles):

```ts
route.length;                 // world length
route.getPointAt(u);          // [x, y, z] in path space at normalized arc length u
route.getTangentAt(u);        // unit direction
route.getSpacedPoints(50);    // evenly spaced points
route.getWaypointDistances(); // distance of each waypoint along the path
```

These return path-space coordinates. For 2D paths or custom coordinate systems, convert with `coordinates.toWorld(point, route.dimension)`.

## Saving from the running game

With Vite: `pathEditorSavePlugin({ file: 'src/paths/level1.paths.json' })` in the config, and a panel `onSave` that calls `saveToDevServer(json)`. The plugin validates the file with the core parser before writing it. See README → "Complex projects".

## Using metadata

Metadata is free-form and never interpreted by the package. Typical uses: waypoint waits, speed multipliers, animation triggers, spawn markers, camera hints. Keep it JSON-serializable.

Game code that needs specific points should look them up by a stable key (e.g. `metadata.name`), not by index, so inserting points in the editor doesn't shift them. The panel edits metadata as JSON. Protect points your code depends on with `canEdit`.
