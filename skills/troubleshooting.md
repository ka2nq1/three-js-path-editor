# Troubleshooting

Run `npx path-editor doctor` first. It finds the scene, camera, renderer, loop, path files and unguarded editor imports.

## Editor

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Nothing is drawn | `enable()` not called | Call `editor.enable()` |
| Nothing is drawn, or it's frozen | `editor.update(dt)` not called | Call it every frame from the existing loop |
| Nothing is drawn | Editor got a scene that isn't rendered | Pass the scene used in `renderer.render(scene, camera)` |
| Paths drawn but markers huge/tiny or picking is off | Wrong camera (not the one rendering) | Pass the active camera; call `editor.setCamera()` on camera switches |
| Paths hidden | View toggle off | `editor.setView({ paths: true })` |
| Game renders with `camera.layers` and editor objects are invisible | Editor objects are on layer 0 | `editor.root.traverse(o => o.layers.set(N))` after paths are loaded, or enable layer 0 on the camera in dev |
| Clicks don't select points | Another element covers the canvas (often an invisible full-screen layer), or wrong `domElement` | Read the console warning / `editor.on('inputblocked')`, which names the covering element. Make it `pointer-events: none` in the `enabled` handler, or pass an element that receives the input and covers the canvas exactly as `domElement` |
| Panel buttons don't react | Your own CSS/JS made the panel click-through (e.g. `pointer-events: none` on every sibling of the canvas) | Exclude elements with the `data-path-editor-ui` attribute |
| Can't look around to edit (camera on a rail / attached to a player) | Game camera rig | `FlyControls` + `cameraControls: fly` + `restoreCameraOnDisable: true`, toggled from `editor.on('enabled')` |
| Weapon/cockpit mesh flies with the free camera | It's a child of the camera | Hide camera children in the `enabled` handler |
| Edited curve doesn't match what the game follows | Different Catmull-Rom parametrization | Set `curve.parametrization` (e.g. `'centripetal'` for `CatmullRomCurve3(..., 'centripetal')`) |
| Game crashes after a point was deleted in the editor | Code looks points up by metadata | Protect them with `canEdit` (`deleteWaypoint`) |
| Ground routes float / sink after editing | No constraint | `constrainWaypoint: surfaceConstraint(() => [terrain])`, then `editor.applyConstraints()` after import |
| Save does nothing / 404 | Dev server started before the plugin was added, or endpoint mismatch | Restart the dev server; `saveToDevServer(json, { endpoint })` must match `pathEditorSavePlugin({ endpoint })` |
| `Cannot find module 'three-path-editor/editor'` (TS) | `moduleResolution: "node"` with an old package version | Update the package (ships `typesVersions`) or use `"bundler"` |
| Clicking always rotates the camera / camera moves while dragging gizmo | Camera controls not passed | `new PathEditor({ ..., cameraControls: controls })` |
| Clicks select but the game also reacts (shoots etc.) | Game listens to the same pointer events | Disable game input while the editor is enabled (`editor.on('enabled', ...)`) |
| Game raycasts hit editor markers | Game raycasts `scene.children` recursively | Skip objects with `userData.pathEditor === true`, or disable the editor |
| Double-click / Shift+click on the line doesn't insert | Click hit a waypoint marker, or the line isn't visible | Click between markers. Make sure `view.paths` is on |
| Shift+click adds nothing | No path selected, or ray misses the placement plane | Select a path first. For 3D, the plane passes through the selected point. Use `objectPlacement([...])` for terrain |
| Gizmo only shows two axes | The path is 2D | Expected: 2D paths only move on their plane |
| Cmd/Ctrl+Z does nothing | Another handler called `preventDefault()` first, focus is in a text field, or `keyboardShortcuts: false` | Call `editor.undo()` from your own binding, or click the panel's ↶ Undo |
| Undo reverts too much / too little | Scripted edits aren't grouped | Wrap them in `editor.history.begin()` … `end()`. Call `editor.history.clear()` after loading data |
| Keyboard shortcuts clash with game keys | Default shortcuts enabled | `new PathEditor({ ..., keyboardShortcuts: false })` |
| Editor code in production bundle | Static import of `three-path-editor/editor` | Dynamic import behind `import.meta.env.DEV` / `NODE_ENV` |
| `TransformControls` errors on old Three.js | Three.js older than r150 | Upgrade Three.js |
| Two canvases / black screen after integrating | A new renderer/scene was created | Remove it and reuse the project's renderer and scene |

## PathFollower

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Object doesn't move | `follower.update(dt)` not called, or `autoPlay: false` | Call it from the loop; `follower.play()` |
| Object moves once then stops | Loop mode `none` (default) | `loop: true` or `'pingpong'` |
| Object faces sideways/backwards | Model forward axis isn't +Z | `orientation: { forward: [1,0,0] }` (or `[0,0,-1]`, etc.) |
| Object is upside down / rolled | Model up axis isn't +Y | `orientation: { up: [0,0,1] }` or `offset: [x, y, z]` radians |
| Car pitches on slopes | Full 3D orientation | `orientation: { yawOnly: true }` |
| Object banks the wrong way | Model's axes differ from +Z forward / +Y up | Fix `orientation.forward`/`up` first; if needed `orientation.rollScale: -1` |
| No banking / speed changes | `applyRoll: false` / `useWaypointSpeed: false`, or values not set | Set `roll`/`speed` on waypoints (panel) and keep the defaults |
| Speed changes feel abrupt | `interpolation: 'step'` | Use `'smooth'` (default) or `'linear'` |
| Rotation jitters at tight corners | Instant rotation | `orientation: { smoothing: 6 }` |
| Object is offset from the drawn path | Object's parent is transformed and `space: 'parent'` | Use the default `space: 'world'` |
| 2D path lies on the wrong plane | Different coordinate systems in editor and follower | Pass the same `coordinates` to both |
| Speed depends on waypoint spacing | You used `getPoint(t)` | Use `getPointAt(u)` / `PathFollower` (arc-length based) |
| Game code overwrites the position | Game also moves the object | Pause that code, or read `path.getPointAt()` and feed the game's movement |
| Object stays where the preview left it | Preview detached with `restoreOnDetach: false` | Default restores the transform. Use `editor.detachPreview()` |

## JSON

| Error | Fix |
| --- | --- |
| `PathFormatError: Path file version N is newer than supported` | Update `three-path-editor` |
| `... .dimension must be 2 or 3` | Fix the field. 2D positions are `[x, y]` |
| `... .position must be an array of 2 or 3 finite numbers` | Check for `NaN`/`null`/strings |
| `Duplicate path id` | Ids must be unique per file |
| `Path "x" not found` | Check the id in the file (the panel's **Id** field) |

## Still stuck

1. `npx path-editor doctor --json` and read `detections`.
2. Log `editor.root.parent === scene`, `editor.enabled`, `editor.paths.length`.
3. Make sure the editor's camera is the one passed to `renderer.render`.
4. Try the demo in this repository (`npm run demo`) to compare behaviour.
