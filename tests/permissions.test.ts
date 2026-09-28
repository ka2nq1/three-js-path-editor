// @vitest-environment jsdom
import { PerspectiveCamera, Scene } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Path } from '../src/core';
import { PathEditor, PathEditorPanel, ThreePathRenderer, type EditorAction, type PathEditorOptions } from '../src/three';

const disposables: { dispose(): void }[] = [];
afterEach(() => {
  for (const d of disposables.splice(0)) d.dispose();
});

function setup(canEdit?: PathEditorOptions['canEdit']) {
  const domElement = document.createElement('canvas');
  document.body.appendChild(domElement);
  const editor = new PathEditor({ scene: new Scene(), camera: new PerspectiveCamera(), domElement, canEdit });
  disposables.push(editor);
  const path = editor.createPath({
    id: 'route',
    curve: 'linear',
    points: [{ position: [0, 0, 0], metadata: { name: 'start' } }, [10, 0, 0], [20, 0, 0]],
  });
  return { editor, path };
}

const isNamed = (path: Path, index: number | null) => index !== null && typeof path.waypoints[index]?.metadata.name === 'string';

describe('Path metadata setters', () => {
  it('replace metadata with copies and are undoable', async () => {
    const { editor, path } = setup();
    editor.history.clear();
    const meta = { name: 'finish', tags: ['a'] };
    path.setWaypointMetadata(2, meta);
    meta.tags.push('b');
    expect(path.waypoints[2].metadata).toEqual({ name: 'finish', tags: ['a'] });
    await Promise.resolve();
    path.setMetadata({ kind: 'ground' });
    expect(path.toJSON().metadata).toEqual({ kind: 'ground' });
    await Promise.resolve();
    editor.undo();
    expect(path.metadata).toEqual({});
    expect(path.waypoints[2].metadata).toEqual({ name: 'finish', tags: ['a'] });
  });
});

describe('labelFormatter', () => {
  it('controls label text, and can hide labels', () => {
    const path = new Path({ id: 'p', points: [[0, 0, 0], { position: [1, 0, 0], metadata: { name: 'gate' } }] });
    const labels = vi.fn(({ waypoint }) => (waypoint.metadata.name as string) ?? null);
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const renderer = new ThreePathRenderer(path, { showLabels: true, labelFormatter: labels });
    disposables.push(renderer);
    renderer.update(new PerspectiveCamera(), 800);
    expect(labels).toHaveBeenCalledWith(expect.objectContaining({ path, index: 1 }));
    const sprites: unknown[] = [];
    renderer.group.traverse((o) => void (o.type === 'Sprite' && sprites.push(o)));
    expect(sprites).toHaveLength(1);
    getContext.mockRestore();
  });
});

describe('canEdit', () => {
  it('refuses protected edits through editor methods and reports them', () => {
    const { editor, path } = setup((action, { path, waypointIndex }) =>
      action === 'deletePath' || action === 'renamePath' ? false : !(action === 'deleteWaypoint' && isNamed(path, waypointIndex)),
    );
    const denied = vi.fn();
    editor.on('denied', denied);
    editor.select('route', 0);
    editor.deleteSelectedWaypoint();
    expect(path.waypoints).toHaveLength(3);
    expect(denied).toHaveBeenCalledWith(expect.objectContaining({ action: 'deleteWaypoint', path, waypointIndex: 0 }));
    editor.removeWaypoint('route', 1);
    expect(path.waypoints).toHaveLength(2);
    expect(editor.removePath('route')).toBeUndefined();
    expect(editor.renamePath('route', 'other')).toBe(false);
    expect(editor.paths).toEqual([path]);
  });

  it('asks for every action the editor can perform', () => {
    const seen = new Set<EditorAction>();
    const { editor } = setup((action) => (seen.add(action), false));
    editor.select('route', 1);
    editor.addWaypoint();
    editor.insertWaypointAt('route', 0.5);
    editor.moveWaypoint('route', 1, [1, 1, 1]);
    editor.reorderWaypoint('route', 1, 2);
    editor.shiftSelectedWaypoint(1);
    editor.removeWaypoint('route', 1);
    editor.renamePath('route', 'x');
    editor.removePath('route');
    expect([...seen].sort()).toEqual(
      ['addWaypoint', 'deletePath', 'deleteWaypoint', 'moveWaypoint', 'renamePath', 'reorderWaypoint'].sort(),
    );
    expect(editor.getPath('route')!.waypoints.map((w) => w.position)).toEqual([[0, 0, 0], [10, 0, 0], [20, 0, 0]]);
  });

  it('disables the matching panel controls', () => {
    const { editor } = setup((action, { path, waypointIndex }) => {
      if (action === 'editCurve' || action === 'deletePath') return false;
      return !isNamed(path, waypointIndex);
    });
    editor.select('route', 0);
    const panel = new PathEditorPanel(editor);
    disposables.push(panel);
    const el = (name: string) => panel.element.querySelector<HTMLInputElement>(`[data-el="${name}"]`)!;
    for (const name of ['curve', 'closed', 'tension', 'reverse', 'delpath', 'del', 'x', 'meta-wp', 'speed-wp']) {
      expect(el(name).disabled).toBe(true);
    }
    expect(el('add').disabled).toBe(false);
    editor.select('route', 1);
    panel.refresh();
    for (const name of ['del', 'x', 'meta-wp', 'speed-wp']) expect(el(name).disabled).toBe(false);
  });
});

describe('panel metadata editor', () => {
  it('edits waypoint and path metadata as JSON and rejects non-objects', () => {
    const { editor, path } = setup();
    editor.select('route', 0);
    const panel = new PathEditorPanel(editor, { formatWaypoint: ({ waypoint }) => (waypoint.metadata.name as string) ?? null });
    disposables.push(panel);
    expect(panel.element.querySelector('[data-idx="0"]')!.textContent).toContain('start');
    const pointMeta = panel.element.querySelector<HTMLTextAreaElement>('[data-el="meta-wp"]')!;
    expect(JSON.parse(pointMeta.value)).toEqual({ name: 'start' });

    pointMeta.value = '{"name": "launch", "wait": 2}';
    pointMeta.dispatchEvent(new Event('change', { bubbles: true }));
    expect(path.waypoints[0].metadata).toEqual({ name: 'launch', wait: 2 });

    pointMeta.value = '[1, 2]';
    pointMeta.dispatchEvent(new Event('change', { bubbles: true }));
    expect(pointMeta.classList.contains('tpe-invalid')).toBe(true);
    expect(path.waypoints[0].metadata).toEqual({ name: 'launch', wait: 2 });

    const pathMeta = panel.element.querySelector<HTMLTextAreaElement>('[data-el="meta-path"]')!;
    pathMeta.value = '{"snap": true}';
    pathMeta.dispatchEvent(new Event('change', { bubbles: true }));
    expect(path.metadata).toEqual({ snap: true });
  });
});
