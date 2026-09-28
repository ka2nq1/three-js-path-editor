// @vitest-environment jsdom
import { Mesh, Object3D, PerspectiveCamera, Scene } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PathEditor, PathEditorPanel } from '../src/three';

const created: PathEditor[] = [];
afterEach(() => {
  for (const editor of created.splice(0)) editor.dispose();
});

function setup() {
  const scene = new Scene();
  const camera = new PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.set(0, 50, 50);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const domElement = document.createElement('canvas');
  document.body.appendChild(domElement);
  const controls = { enabled: true };
  const editor = new PathEditor({ scene, camera, renderer: { domElement }, cameraControls: controls });
  created.push(editor);
  return { scene, camera, domElement, editor, controls };
}

describe('PathEditor', () => {
  it('only touches the scene through its root group', () => {
    const { scene, editor } = setup();
    const gameObject = new Mesh();
    scene.add(gameObject);
    expect(scene.children).toEqual([gameObject]);
    editor.enable();
    expect(scene.children).toEqual([gameObject, editor.root]);
    editor.disable();
    expect(scene.children).toEqual([gameObject]);
    editor.enable();
    editor.dispose();
    expect(scene.children).toEqual([gameObject]);
  });

  it('creates, selects and renders paths', () => {
    const { editor } = setup();
    editor.enable();
    const path = editor.createPath({ id: 'heli', dimension: 3, curve: 'catmull-rom', points: [[0, 0, 0], [10, 5, 0], [20, 0, 10]] });
    expect(editor.selectedPath).toBe(path);
    editor.update(0.016);
    const renderer = editor.getRenderer(path)!;
    expect(renderer.getPickables().markers).toHaveLength(3);
    expect(renderer.group.parent).toBe(editor.root);
    editor.loadPath(path); // idempotent
    expect(editor.paths).toHaveLength(1);
  });

  it('adds, moves, reorders and deletes waypoints', () => {
    const { editor } = setup();
    const path = editor.createPath({ id: 'p', curve: 'linear', points: [[0, 0, 0], [10, 0, 0]] });
    editor.select('p', 0);
    expect(editor.addWaypoint()).toBe(1);
    expect(path.waypoints[1].position).toEqual([5, 0, 0]);
    editor.moveWaypoint('p', 1, [5, 3, 0]);
    expect(path.waypoints[1].position).toEqual([5, 3, 0]);
    editor.shiftSelectedWaypoint(1);
    expect(editor.selection.waypointIndex).toBe(2);
    expect(path.waypoints[2].position).toEqual([5, 3, 0]);
    editor.deleteSelectedWaypoint();
    expect(path.waypoints).toHaveLength(2);
    expect(editor.selection.waypointIndex).toBe(1);
  });

  it('exports and imports JSON, preserving unknown data', () => {
    const { editor } = setup();
    const data = {
      version: 1,
      project: 'demo',
      paths: [{ id: 'r', dimension: 2, curve: { type: 'linear', closed: false, tension: 0.5 }, points: [{ position: [1, 2], metadata: { a: 1 } }], metadata: { b: 2 } }],
    };
    editor.createPath({ id: 'old' });
    const imported = editor.import(JSON.stringify(data));
    expect(imported).toHaveLength(1);
    expect(editor.paths.map((p) => p.id)).toEqual(['r']);
    expect(editor.export()).toEqual(data);
    editor.import({ version: 1, paths: [{ id: 's', dimension: 3, points: [] }] }, { merge: true });
    expect(editor.paths.map((p) => p.id)).toEqual(['r', 's']);
  });

  it('previews objects and restores their transform on detach', () => {
    const { editor } = setup();
    editor.enable();
    const path = editor.createPath({ curve: 'linear', points: [[0, 0, 0], [10, 0, 0]] });
    const object = new Object3D();
    object.position.set(1, 2, 3);
    const preview = editor.attachPreview(object, path, { speed: 5, loop: 'none' })!;
    editor.update(1);
    expect(object.position.x).toBeCloseTo(5);
    preview.pause();
    editor.update(1);
    expect(object.position.x).toBeCloseTo(5);
    editor.detachPreview();
    expect(object.position.toArray()).toEqual([1, 2, 3]);
  });

  it('creates an owned preview marker when no object is given', () => {
    const { editor } = setup();
    editor.enable();
    editor.createPath({ points: [[0, 0, 0], [10, 0, 0]] });
    const preview = editor.previewPath(editor.paths[0].id)!;
    expect(preview.object.parent).toBe(editor.root);
    editor.removePath(editor.paths[0].id);
    expect(editor.preview).toBeNull();
    expect(preview.object.parent).toBeNull();
  });

  it('creates a path in front of the camera', () => {
    const { editor } = setup();
    const path = editor.createPathInView({ dimension: 2 });
    expect(path.waypoints).toHaveLength(3);
    for (const w of path.waypoints) expect(Math.abs(w.position[1])).toBeLessThan(1);
  });

  it('emits events', () => {
    const { editor } = setup();
    const onAdded = vi.fn();
    const onChange = vi.fn();
    editor.on('pathadded', onAdded);
    editor.on('change', onChange);
    const path = editor.createPath({ points: [[0, 0, 0]] });
    path.addWaypoint([1, 0, 0]);
    expect(onAdded).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('drags Bezier handles through the gizmo and mirrors the opposite handle', () => {
    const { editor } = setup();
    editor.enable();
    const path = editor.createPath({ curve: 'bezier', points: [[0, 0, 0], [10, 0, 0], [20, 0, 0]] });
    editor.select(path.id, 1, 'out');
    editor.update(0);
    // Simulate a gizmo drag: move the gizmo target, then fire TransformControls' objectChange.
    const internals = editor as unknown as { gizmoProxy: Object3D; onGizmoMoved(): void };
    internals.gizmoProxy.position.set(10, 4, 0);
    internals.onGizmoMoved();
    const wp = path.waypoints[1];
    expect(wp.handleOut).toEqual([0, 4, 0]);
    // Auto handle length was 20 * 0.5 / 3; direction mirrored.
    expect(wp.handleIn![0]).toBeCloseTo(0);
    expect(wp.handleIn![1]).toBeCloseTo(-10 / 3);
  });

  it('deletes the selected path completely', () => {
    const { editor } = setup();
    editor.enable();
    const path = editor.createPath({ id: 'to-delete', points: [[0, 0, 0], [5, 0, 0]] });
    editor.update(0);
    const group = editor.getRenderer(path)!.group;
    expect(editor.deleteSelectedPath()).toBe(path);
    expect(editor.paths).toHaveLength(0);
    expect(editor.selectedPath).toBeNull();
    expect(group.parent).toBeNull();
  });

  it('inserts a waypoint on the curve', () => {
    const { editor } = setup();
    const path = editor.createPath({ id: 'c', curve: 'linear', points: [[0, 0, 0], [10, 0, 0]] });
    expect(editor.insertWaypointAt('c', 0.3)).toBe(1);
    expect(path.waypoints[1].position[0]).toBeCloseTo(3);
    expect(editor.selection).toEqual({ pathId: 'c', waypointIndex: 1, handle: null });
  });

  it('deletes a path from the panel after confirmation', () => {
    const { editor } = setup();
    editor.createPath({ id: 'p1', points: [[0, 0, 0], [1, 0, 0]] });
    const panel = new PathEditorPanel(editor);
    const button = panel.element.querySelector<HTMLButtonElement>('[data-act="delpath"]')!;
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    button.click();
    expect(editor.paths).toHaveLength(1);
    button.click();
    expect(editor.paths).toHaveLength(0);
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    panel.dispose();
  });

  it('edits waypoint speed and roll from the panel', () => {
    const { editor } = setup();
    const path = editor.createPath({ id: 'p2', points: [[0, 0, 0], [1, 0, 0]] });
    editor.select('p2', 1);
    const panel = new PathEditorPanel(editor);
    const set = (name: string, value: string) => {
      const input = panel.element.querySelector<HTMLInputElement>(`[data-el="${name}"]`)!;
      input.value = value;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('speed-wp', '0.5');
    set('roll', '25');
    expect([path.waypoints[1].speed, path.waypoints[1].roll]).toEqual([0.5, 25]);
    set('roll', '');
    expect(path.waypoints[1].roll).toBeUndefined();
    panel.dispose();
  });

  it('undoes a gizmo drag as one step and resets history on import', () => {
    const { editor } = setup();
    editor.enable();
    const path = editor.createPath({ id: 'u', curve: 'linear', points: [[0, 0, 0], [10, 0, 0]] });
    editor.select('u', 1);
    editor.update(0);
    const internals = editor as unknown as { gizmoProxy: Object3D; onGizmoMoved(): void; beginDrag(): void; endDrag(): void };
    internals.beginDrag();
    for (let x = 11; x <= 15; x++) {
      internals.gizmoProxy.position.set(x, 0, 0);
      internals.onGizmoMoved();
    }
    internals.endDrag();
    expect(path.waypoints[1].position).toEqual([15, 0, 0]);
    expect(editor.undo()).toBe(true);
    expect(path.waypoints[1].position).toEqual([10, 0, 0]);
    expect(editor.redo()).toBe(true);
    expect(path.waypoints[1].position).toEqual([15, 0, 0]);
    editor.import({ version: 1, paths: [] });
    expect(editor.canUndo).toBe(false);
  });

  it('undoes path deletion from the keyboard (Cmd+Z)', () => {
    const { editor } = setup();
    editor.enable();
    const path = editor.createPath({ id: 'k', points: [[0, 0, 0], [1, 0, 0]] });
    editor.history.clear();
    editor.deleteSelectedPath();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', metaKey: true, cancelable: true }));
    expect(editor.paths).toEqual([path]);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', ctrlKey: true, shiftKey: true, cancelable: true }));
    expect(editor.paths).toHaveLength(0);
    editor.dispose();
  });

  it('mounts an optional DOM panel', () => {
    const { editor } = setup();
    editor.createPath({ id: 'panel-path', points: [[0, 0, 0], [1, 0, 0]] });
    const panel = new PathEditorPanel(editor);
    expect(panel.element.isConnected).toBe(true);
    expect(panel.element.querySelector('[data-el="path"]')!.textContent).toContain('panel-path');
    panel.dispose();
    expect(panel.element.isConnected).toBe(false);
  });

  it('reports overlays that swallow presses meant for the canvas, once', () => {
    const { editor, domElement } = setup();
    vi.spyOn(domElement, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 100));
    Object.assign(domElement, { setPointerCapture: () => {}, releasePointerCapture: () => {} });
    const overlay = document.createElement('div');
    overlay.id = 'hud';
    document.body.appendChild(overlay);
    const blocked = vi.fn();
    editor.on('inputblocked', blocked);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    editor.enable();
    const press = (target: Element, x: number, y: number) =>
      target.dispatchEvent(new MouseEvent('pointerdown', { clientX: x, clientY: y, bubbles: true }));

    press(overlay, 50, 50);
    press(overlay, 60, 50);
    expect(blocked).toHaveBeenCalledTimes(2);
    expect(blocked.mock.calls[0][0].target).toBe(overlay);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('<div#hud>');

    press(overlay, 500, 50);
    press(domElement, 50, 50);
    const panel = new PathEditorPanel(editor);
    press(panel.element, 50, 50);
    expect(blocked).toHaveBeenCalledTimes(2);

    editor.disable();
    press(overlay, 50, 50);
    expect(blocked).toHaveBeenCalledTimes(2);
    panel.dispose();
    overlay.remove();
    warn.mockRestore();
  });

  it('can silence the blocked-input warning', () => {
    const scene = new Scene();
    const domElement = document.createElement('canvas');
    document.body.appendChild(domElement);
    vi.spyOn(domElement, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 100));
    const editor = new PathEditor({ scene, camera: new PerspectiveCamera(), domElement, diagnostics: false });
    created.push(editor);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    editor.enable();
    document.body.dispatchEvent(new MouseEvent('pointerdown', { clientX: 10, clientY: 10, bubbles: true }));
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
