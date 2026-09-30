// @vitest-environment jsdom
import { Object3D, PerspectiveCamera, Scene } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Path, PathCursor, PathFollower } from '../src';
import { PathEditor, PathEditorPanel, PathPreview } from '../src/three';

const line = () => new Path({ curve: 'linear', points: [[0, 0, 0], [10, 0, 0], [20, 0, 0]] });

/** Records every cursor event type in order. */
function record(on: (type: 'progress' | 'waypoint' | 'loop' | 'complete' | 'play' | 'pause' | 'reset', fn: () => void) => unknown) {
  const log: string[] = [];
  for (const type of ['progress', 'waypoint', 'loop', 'complete', 'play', 'pause', 'reset'] as const) on(type, () => log.push(type));
  return log;
}

describe('PathCursor playback events', () => {
  it('emits play/pause once per real state change', () => {
    const cursor = new PathCursor({ path: line(), autoPlay: false });
    const log = record((t, fn) => cursor.events.on(t, fn));
    cursor.play();
    cursor.play();
    cursor.pause();
    cursor.pause();
    cursor.play();
    expect(log).toEqual(['play', 'pause', 'play']);
  });

  it('does not emit play for autoPlay at construction', () => {
    const onPlay = vi.fn();
    new PathFollower({ object: new Object3D(), path: line(), onPlay });
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('emits complete then pause at the end with loop none, already stopped', () => {
    const follower = new PathFollower({ object: new Object3D(), path: line(), speed: 30 });
    const log = record((t, fn) => follower.on(t, fn));
    let playingInPause: boolean | null = null;
    follower.on('pause', () => (playingInPause = follower.isPlaying));
    follower.update(1);
    expect(log).toEqual(['waypoint', 'waypoint', 'progress', 'complete', 'pause']);
    expect(playingInPause).toBe(false);
    follower.update(1);
    expect(log).toHaveLength(5);
  });

  it('skips the automatic pause when a complete listener restarts playback', () => {
    const follower = new PathFollower({ object: new Object3D(), path: line(), speed: 30 });
    const log = record((t, fn) => follower.on(t, fn));
    follower.on('complete', () => follower.play());
    follower.update(1);
    const end = log.indexOf('complete');
    expect(log.slice(end, end + 3)).toEqual(['complete', 'reset', 'play']);
    expect(log).not.toContain('pause');
    expect(follower.isPlaying).toBe(true);
  });

  it('never pauses on loop or pingpong', () => {
    for (const loop of ['loop', 'pingpong'] as const) {
      const onPause = vi.fn();
      const follower = new PathFollower({ object: new Object3D(), path: line(), speed: 30, loop, onPause });
      follower.update(1).update(1);
      expect(onPause).not.toHaveBeenCalled();
    }
  });

  it('reset emits reset and keeps the play state; seeking does not emit reset', () => {
    const onReset = vi.fn();
    const onPause = vi.fn();
    const follower = new PathFollower({ object: new Object3D(), path: line(), speed: 5, onReset, onPause });
    follower.update(1).reset();
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(follower.isPlaying).toBe(true);
    expect(follower.progress).toBe(0);
    follower.pause().reset();
    expect(follower.isPlaying).toBe(false);
    expect(onReset).toHaveBeenCalledTimes(2);
    follower.setProgress(0.5).setDistance(3).setPath(line());
    expect(onReset).toHaveBeenCalledTimes(2);
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it('play() on a completed cursor emits reset then play', () => {
    const follower = new PathFollower({ object: new Object3D(), path: line(), speed: 30 });
    follower.update(1);
    const log = record((t, fn) => follower.on(t, fn));
    follower.play();
    expect(log).toEqual(['reset', 'play']);
  });
});

describe('PathPreview playback events', () => {
  it('forwards follower events, including toggle', () => {
    const preview = new PathPreview(new Object3D(), line());
    const log = record((t, fn) => preview.on(t, fn));
    preview.toggle();
    preview.toggle();
    preview.pause().pause();
    expect(log).toEqual(['pause', 'play', 'pause']);
  });

  it('accepts onPlay/onPause/onReset options', () => {
    const onPlay = vi.fn();
    const onPause = vi.fn();
    const onReset = vi.fn();
    const preview = new PathPreview(new Object3D(), line(), { autoPlay: false, onPlay, onPause, onReset });
    preview.play().reset().pause();
    expect([onPlay, onReset, onPause].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it('keeps listeners across setPath', () => {
    const preview = new PathPreview(new Object3D(), line());
    const onPause = vi.fn();
    const onPlay = vi.fn();
    preview.on('pause', onPause);
    preview.on('play', onPlay);
    preview.setPath(new Path({ curve: 'linear', points: [[0, 0, 0], [0, 0, 5]] }));
    preview.pause().play();
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it('emits pause on detach only when playing', () => {
    const playing = new PathPreview(new Object3D(), line());
    const onPause = vi.fn();
    playing.on('pause', onPause);
    playing.detach();
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(playing.isPlaying).toBe(false);

    const paused = new PathPreview(new Object3D(), line(), { autoPlay: false, onPause });
    paused.detach();
    expect(onPause).toHaveBeenCalledTimes(1);
  });
});

describe('PathEditor previewstate', () => {
  const created: { dispose(): void }[] = [];
  afterEach(() => {
    for (const d of created.splice(0)) d.dispose();
  });

  function setup() {
    const camera = new PerspectiveCamera(60, 1, 0.1, 1000);
    const domElement = document.createElement('canvas');
    document.body.appendChild(domElement);
    const editor = new PathEditor({ scene: new Scene(), camera, renderer: { domElement } });
    created.push(editor);
    const path = editor.createPath({ id: 'p', curve: 'linear', points: [[0, 0, 0], [10, 0, 0], [20, 0, 0]] });
    const states: [PathPreview, boolean][] = [];
    editor.on('previewstate', ({ preview, playing }) => states.push([preview, playing]));
    return { editor, path, states };
  }

  it('fires for API calls, the end of the path and detach', () => {
    const { editor, path, states } = setup();
    const order: string[] = [];
    editor.on('preview', () => order.push('preview'));
    editor.on('previewstate', ({ playing }) => order.push(String(playing)));
    const object = new Object3D();
    const preview = editor.attachPreview(object, path, { speed: 5, loop: 'none' })!;
    expect(order).toEqual(['preview', 'true']);
    preview.pause().pause();
    preview.play();
    editor.enable();
    editor.update(10); // runs to the end: complete -> pause
    expect(preview.isPlaying).toBe(false);
    expect(states.map(([p, s]) => p === preview && s)).toEqual([true, false, true, false]);
    preview.play();
    order.length = 0;
    editor.detachPreview();
    expect(order).toEqual(['false', 'preview']);
    expect(states[states.length - 1]).toEqual([preview, false]);
  });

  it('does not fire on attach or detach of a paused preview', () => {
    const { editor, path, states } = setup();
    editor.attachPreview(new Object3D(), path, { autoPlay: false });
    editor.detachPreview();
    expect(states).toEqual([]);
  });

  it('stops forwarding events of a detached preview', () => {
    const { editor, path, states } = setup();
    const old = editor.attachPreview(new Object3D(), path)!;
    editor.attachPreview(new Object3D(), path, { autoPlay: false });
    states.length = 0;
    old.play();
    expect(states).toEqual([]);
  });

  it('fires for panel buttons', () => {
    const { editor, states } = setup();
    const panel = new PathEditorPanel(editor);
    created.push(panel);
    const button = (name: string) => panel.element.querySelector<HTMLButtonElement>(`[data-act="${name}"]`)!;
    button('preview').click();
    const preview = editor.preview!;
    panel.refresh(); // enables the preview buttons (normally on the next frame)
    button('play').click(); // pause
    button('play').click(); // play
    button('reset').click(); // keeps playing, no state change
    button('stop').click();
    expect(states).toEqual([[preview, true], [preview, false], [preview, true], [preview, false]]);
  });
});
