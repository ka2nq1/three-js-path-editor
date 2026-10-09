# Changelog

## 0.4.0

### Added

- `PathFollower` can start somewhere other than the first waypoint: `startFrom: 'closest'` seeks to the point nearest the object, `startFrom: 'object'` keeps the object where it stands and runs a straight lead-in leg onto the path at the speed the path opens with, then emits the new `enter` event (`onEnter`, `isEntering`).
- `initialRotation: 'object'` and `PathFollower.seedRotation(q)` seed what rotation smoothing eases from, so an object that starts on another heading turns instead of snapping on the first frame.
- Explicit heading access for `yawOnly` setups, where an XYZ Euler mirrors any yaw past ±90°: `PathFollower.yaw` / `setYaw(rad)` and `Orienter.yawOf(q)` / `yawTo(yaw, q)`. `Orienter.worldUp` is public.
- Seeking by waypoint: `PathFollower.setWaypoint(index | name)` and `PathCursor.seekWaypoint`, plus `Path.indexOfWaypoint(name | predicate)` and `Path.distanceOfWaypoint(index | name)`.
- Seeks can deliver the waypoints they passed over: `{ emitWaypoints: true }` on `setDistance`, `setProgress`, `setWaypoint` and the `PathCursor.seek*` methods.
- `PathCursor.hasPassed(index | name)` / `PathFollower.hasPassed` and `PathFollower.once(type, fn, filter?)`, so waiting for a named point needs no index bookkeeping.
- Riders: `PathFollower.addRider({ object, offset, lateral, orientation })`, `removeRider`, `riders` and the `riders` option carry further objects along the leader's path at an offset along it and sideways, sharing one cursor (convoys, flocks, a trailing camera).
- `curve.linearHeight` interpolates a 3D path's height linearly between waypoints while x/z follow the curve, so a route authored on a floor cannot sag below it where a flat stretch meets a climb. New `LinearHeightCurve`.

- `PathEditor.suspendCameraControls()` returns a counted release, so the editor's gizmo and host gizmos can hold the host's camera controls at the same time without either restoring the other's state. Host gizmos should use it instead of writing `cameraControls.enabled`.
- `PathEditor.gizmoEngaged` and `PathEditor.gizmo` say whether a gizmo owns the current press; `otherControls` lists host gizmos, whose press the editor then leaves alone instead of treating it as a click into empty space; `claimPointer(event)` hands a press to the host outright.
- `isolateUi` hides and blocks every element on the page except the viewport and `data-path-editor-ui` elements while the editor is enabled. The viewport carries `data-path-editor-viewport` (exported as `EDITOR_VIEWPORT_ATTRIBUTE`) for the session.
- `detachCamera` moves a camera out of its rig into the scene for the editing session, keeping its world pose, and puts it back on `disable()`. Implies `restoreCameraOnDisable`.
- `pivotUnderPointer` keeps the camera controls' `target` on the surface under the pointer, at that depth along the view axis, so zoom and pan don't stall near a fixed pivot. Takes `{ objects, minDistance }`.
- `PathEditorPanel` option `hideWhenDisabled` and method `setVisible()`.
- Authoring a facing: `Waypoint.yaw` (degrees around the path's up axis) with a rotate gizmo mode in the editor (`R`, `setGizmoMode`, `gizmoMode`, `gizmomode` event), facing arrows in the view (`facings`), and a Yaw field in the panel. Travel still takes its heading from the curve; `yaw` is for what stands still.
- Authored times: `Waypoint.time` plus `Path.timeRange`, `duration`, `distanceAtTime`, `timeAtDistance`, `getPointAtTime`, `getTangentAtTime`, `PathCursor.seekTime`/`time` and `PathFollower.setTime`/`time`. Two paths that carry the same times can be sampled at the same time, which is the only sane way to keep a camera path and its target in step.
- Camera rigs: `CameraRig`, the `rigs` option, `addRig`, `removeRig`, `getRig`, `rigs`, `playRig`, `stopRig`, `flyingRig` and the `rigstate` event. A rig pairs a camera path with the path it looks at, draws sight lines between the matching points (view `sightlines`) and can fly the editor's own camera along it, so framing no longer needs a game restart.
- Markers: `Path.kind = 'marker'` (`isMarker`, `kind` in JSON) for a single named place — a spawn point, a prop, a light. `PathEditor.createMarker()`, `markers`, `routes` and a **+ Marker** button; the editor refuses extra points and curve edits on a marker. Markers share the paths' file, selection, gizmo, history and JSON instead of being a parallel entity.
- `waypointremoved: { path, index, waypoint }` fires when the editor deletes a waypoint, in the same synchronous task, so a host that hands a deleted point's name to a neighbour lands in the same undo step instead of diffing after `change`.
- `SurfaceCheck` and the `surface` option tick every span of a curve that runs below the floors it was authored on (view `surface`, `editor.surfaceWarnings`) — the sag `curve.linearHeight` removes, which was invisible in the editor.
- `isEditorObject(object)` tells host raycasts whether a hit belongs to the editor; `objectPlacement` and `surfaceConstraint` now use it, so a hit on a marker inside the editor's groups is skipped too.

- `npm run release:vendor -- <creative-dir>` ([scripts/release-vendor.mjs](scripts/release-vendor.mjs)) tests, bumps, packs the package into a creative's `vendor/` folder and repoints its package.json at the tarball, for platforms that run `npm install` on an uploaded zip without a registry. See [Releasing into a creative](README.md#releasing-into-a-creative-vendored-tarball).

### Fixed

- `disable()` ended a `TransformControls` drag by switching the controls off, which made them ignore the `pointerup` and stay `dragging` forever: after the next `enable()` the move gizmo never grabbed a press again. The drag is now ended first.
- The editor's pointer handler moved to `window` in the capture phase. On the canvas itself, listeners run in registration order, and `TransformControls` had registered its own first, so claiming a press with `stopImmediatePropagation()` did not actually get ahead of it.

### Changed

- The `waypoint` event payload now also carries the `waypoint` itself and its `distance` along the path.
- Sampling allocates nothing: `Path.getPoint`, `getPointAt`, `getPointAtDistance`, `getTangent`, `getTangentAt`, `getTangentAtDistance`, the `Curve` interface, the `CoordinateSystem` converters and the `vecMath` helpers all take an optional output vector, and the curves, the cursor's waypoint crossings and `PathFollower` reuse their own buffers instead of allocating per call and per frame.
- `createCurve` takes the path dimension as a third argument (for `linearHeight`); `locateSegment` keeps its signature, with `locateSegmentInto` as the allocation-free variant.

## 0.3.0

### Added

- Playback events. `PathCursor`, `PathFollower` and `PathPreview` emit `play` and `pause` when `isPlaying` actually changes, and `reset` on `reset()`. Reaching the end with loop `'none'` emits `complete`, then `pause`. `play()` on a completed cursor emits `reset`, then `play`. Seeks (`setProgress`, `setDistance`, `setPath`) emit nothing.
- `onPlay`, `onPause` and `onReset` options on `PathFollower` and `PathPreview`.
- `PathPreview.on(type, listener)` forwards the follower's events. Listeners survive `setPath`.
- `PathEditor` event `previewstate: { preview, playing }`. It fires for panel buttons, API calls and the end of a non-looping path, after `preview` when an attached preview starts playing, and with `playing: false` when a playing preview is detached.

### Changed

- `PathPreview.detach()` pauses the follower before removing listeners, so `isPlaying` is `false` afterwards and listeners get a final `pause`.
- The panel's Play/Pause label now updates when a non-looping preview reaches its end.

## 0.2.0

- Complex-project integration docs, Catmull-Rom parametrization, `constrainWaypoint` / `surfaceConstraint`, metadata editing, label formatter, edit permissions, saving from the running game and session restore.
