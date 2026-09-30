# Changelog

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
