# three-path-editor: notes for development

Commands: `npm test`, `npm run typecheck`, `npm run build`, `npm run demo`, `node bin/path-editor.mjs doctor`.

## Invariants (keep these)

- **Never create a Scene, Camera, Renderer or animation loop** in `src/`. The host app owns them. Everything is driven by `update(dt)`.
- **Layering:** `src/vite` is Node-side (dev-server plugin): it may import only `src/core`, never `three` or browser code, and loads Node built-ins through a non-literal dynamic import so no `@types/node` or bundling is needed. `src/core` and `src/editor` must not import `three`. `src/runtime` may import `three` but never `src/three` or `src/editor`. Only `src/three` may import `three/examples/jsm/*`. `npm run build` + a grep of `dist/chunk-*.js` checks that the core chunk has no three import.
- **Entry points:** `.` = core + runtime (production), `./core` = no three, `./editor` = everything. Editor code must only be reachable from `./editor`. Keep `"sideEffects": false` true: no top-level side effects (the panel injects CSS lazily in its constructor).
- **All editor-created objects** live under `PathEditor.root`, carry `userData.pathEditor = true`, and are disposed by their owner. Never modify host objects or materials. Previews restore the object's transform on detach.
- **Path space vs world space:** `Path` stores path-space coordinates (2D paths keep z = 0). Conversion goes only through `CoordinateSystem`. Don't bake Y-up assumptions into core.
- **JSON format:** versioned (`PATH_FORMAT_VERSION`). Unknown keys and metadata must round-trip at file, path and waypoint level. Format changes need a bump and a step in `migrate()` in `core/serialization.ts`.
- **Waypoint i sits at t = i / segmentCount** for every curve type. Arc-length sampling, waypoint events and rendering depend on this.
- Per-waypoint `speed` (multiplier) and `roll` (degrees, positive = bank right) are first-class waypoint fields, blended by `getWaypointValueAtDistance`. Speed is integrated in substeps in `PathCursor.advance`. Adding fields like these is backwards-compatible (older versions keep them as extras), so no format version bump is needed.
- Undo/redo (`editor/EditorHistory.ts`) snapshots every path's `toJSON()` and restores **in place** (`Path.setData`, `EditorState.replacePaths`) to keep object identity. Every mutation must go through `Path` methods / `markChanged()`, or it won't be recorded. Changes made in one synchronous task form one step (microtask commit). Interactions use `history.begin()/end()`. `EditorState` emits `pathchange` before clamping the selection, and history depends on that order.
- **Host-agnostic integration:** never assume the host's DOM, input system or camera rig. Provide opt-in hooks and diagnostics (`inputblocked`, `enabled` event, `canEdit`, `constrainWaypoint`, `labelFormatter`) instead of heuristics that change host elements or swallow host events. `FlyControls` moves the camera only because the host created and enabled it, and `restoreCameraOnDisable` only puts back what it saved.
- Editor methods that edit on behalf of the user go through `allow()` (`canEdit`) and, for positions, `constrained()`. Direct `Path` calls stay unchecked.
- No object-specific behaviour (vehicles, NPCs...) in the package. Model differences go through `OrientationOptions`.
- Mutate paths through `Path` methods (or call `markChanged()`), so caches and renderers stay in sync.
- The CLI is dependency-free and non-destructive (never overwrite or delete).
- Keep `skills/` in sync with the public API. It's how Claude integrates this package into other projects.
