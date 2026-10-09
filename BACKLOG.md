# Integration feedback from Pure Sniper "Choice Driven" — all delivered in 0.4.0

23 items collected while integrating the vendored package (0.3.0) into
`Miniclip-Playable-Pure-Sniper-Choice-Driven`. That project held **no edits to
the package source**; each item was carried there as host-side code instead.
All of them are implemented in 0.4.0 — see the CHANGELOG for the details and
the README sections linked from it. "Replaces" names the host-side code the
feature makes unnecessary.

## Runtime (`src/runtime`, `src/core`)

| # | Item | Covered by | Replaces |
| --- | --- | --- | --- |
| 1 | `PathFollower` always started at the first waypoint | `startFrom: 'closest' \| 'object'`, `enter` event, `isEntering` | `CharacterActions` straight-line run-in |
| 2 | No way to seed the follower's rotation (first frame snapped) | `initialRotation: 'object'`, `seedRotation(q)` | the hand-driven opening turn |
| 3 | `yawOnly` left the object's Euler flipped past ±90° | `PathFollower.yaw` / `setYaw`, `Orienter.yawOf` / `yawTo` | yaw bookkeeping in host code |
| 4 | No seek to a waypoint | `setWaypoint(index \| name)`, `PathCursor.seekWaypoint`, `Path.indexOfWaypoint` / `distanceOfWaypoint` | manual `getWaypointDistances()` walks |
| 5 | `onWaypoint` carried only `index` | `{ index, waypoint, distance }`, `once(type, fn, filter)`, `hasPassed` | private "already passed" lists |
| 6 | Seeks swallowed waypoint events | `{ emitWaypoints: true }` on every seek | waiters that hung after a cut |
| 7 | Per-call allocations on the sampling path | optional `out` vectors through `Path`, `Curve`, `CoordinateSystem`, `vecMath`; reused buffers in the curves, cursor and follower | — |
| 8 | One path, several objects | `addRider({ object, offset, lateral, orientation })`, `riders` | a follower per flock member |
| 9 | Catmull-Rom sagged in Y, and the editor hid it | `curve.linearHeight`, plus the `surface` check below | `RouteGround.ts` |

## Host integration: camera and input (`src/three`)

| # | Item | Covered by | Replaces |
| --- | --- | --- | --- |
| 10 | `beginDrag`/`endDrag` restored `cameraControls.enabled` as read | `suspendCameraControls()` with a counted release | `GizmoCameraControls.ts` |
| 11 | `disable()` killed a `TransformControls` drag mid-flight | the drag is ended before the controls are switched off | — |
| 12 | No arbitration with a second `TransformControls` | `otherControls`, `claimPointer`, `gizmoEngaged`, `gizmo` | `UnitYawGizmo.claimPress` |
| 13 | The `onPointerDown` capture-phase comment was wrong | the handler moved to `window` in the capture phase | — |
| 14 | A press on a host gizmo counted as empty space | `otherControls` / `claimPointer` | selection fighting |
| 15 | `restoreCameraOnDisable` only saved a local pose | `detachCamera` | host-side camera detach |
| 16 | The package never marked the canvas viewport | `isolateUi`, `EDITOR_VIEWPORT_ATTRIBUTE` | the `EDITING_CSS` block |
| 17 | The panel stayed on screen after `disable()` | `hideWhenDisabled`, `setVisible()` | manual `style.display` |
| 18 | Bare `OrbitControls` stalled near the pivot | `pivotUnderPointer: { objects, minDistance }` | `PathEditorC.pivotUnderPointer` |

## Authoring features

| # | Item | Covered by | Replaces |
| --- | --- | --- | --- |
| 19 | Waypoints had no heading | `Waypoint.yaw`, rotate gizmo mode (`R`), facing arrows, panel field | `UnitYawGizmo.ts` |
| 20 | No waypoint-delete event | `waypointremoved: { path, index, waypoint }`, in the deletion's undo step | `NamedPointKeeper.ts` |
| 21 | No single-point marker type | `kind: 'marker'`, `createMarker()`, `markers` / `routes`, **+ Marker** | one-point paths with curve noise |
| 22 | No camera-rig pairing or preview through the scene camera | `CameraRig`, `addRig`, `playRig`, sight lines | restarting the game to judge framing |
| 23 | Syncing two paths by length was guesswork | `Waypoint.time` and the `Path` time API, used by rigs | sampling two paths by index |

Markers are a `Path` with `kind: 'marker'` rather than a parallel entity: that
keeps one file, one selection, one gizmo and one undo stack, and the editor
refuses points and curve edits on them, which is what the noise was about.
