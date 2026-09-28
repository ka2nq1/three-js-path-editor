import { describe, expect, it, vi } from 'vitest';
import { Path } from '../src/core';
import { EditorHistory, EditorState, bindShortcuts, insertWaypointAtT } from '../src/editor';

function setup() {
  const state = new EditorState();
  const history = new EditorHistory(state);
  const path = new Path({ id: 'a', curve: 'linear', points: [[0, 0, 0], [10, 0, 0]] });
  state.addPath(path);
  history.clear(); // baseline: one path
  return { state, history, path };
}

const flush = () => Promise.resolve();

describe('EditorHistory', () => {
  it('undoes and redoes point edits', async () => {
    const { history, path } = setup();
    path.moveWaypoint(1, [10, 5, 0]);
    await flush();
    path.addWaypoint([20, 0, 0]);
    await flush();
    expect(history.canUndo).toBe(true);
    history.undo();
    expect(path.waypoints).toHaveLength(2);
    expect(path.waypoints[1].position).toEqual([10, 5, 0]);
    history.undo();
    expect(path.waypoints[1].position).toEqual([10, 0, 0]);
    expect(history.undo()).toBe(false);
    history.redo();
    history.redo();
    expect(path.waypoints).toHaveLength(3);
    expect(history.canRedo).toBe(false);
  });

  it('groups all changes of one synchronous operation into one step', async () => {
    const { history, path } = setup();
    path.setCurve('bezier');
    await flush();
    insertWaypointAtT(path, 0.5); // freezes handles + adds a point (several mutations)
    path.setWaypointProperties(1, { roll: 20 });
    await flush();
    history.undo();
    expect(path.waypoints).toHaveLength(2);
    expect(path.waypoints[0].handleOut).toBeNull();
    expect(path.curve.type).toBe('bezier');
  });

  it('groups a drag (begin/end) into one step', () => {
    const { history, path } = setup();
    history.begin();
    for (let x = 1; x <= 20; x++) path.moveWaypoint(1, [10 + x, 0, 0]);
    history.end();
    history.undo();
    expect(path.waypoints[1].position).toEqual([10, 0, 0]);
    history.redo();
    expect(path.waypoints[1].position).toEqual([30, 0, 0]);
  });

  it('commits pending changes before undoing (no await needed)', () => {
    const { history, path } = setup();
    path.moveWaypoint(0, [1, 1, 1]);
    expect(history.canUndo).toBe(true);
    history.undo();
    expect(path.waypoints[0].position).toEqual([0, 0, 0]);
  });

  it('restores a deleted path as the same object', async () => {
    const { state, history, path } = setup();
    state.removePath('a');
    await flush();
    expect(state.paths).toHaveLength(0);
    history.undo();
    expect(state.paths).toEqual([path]);
    path.moveWaypoint(0, [5, 5, 5]); // still wired to the state
    await flush();
    expect(history.canUndo).toBe(true);
  });

  it('undoes path creation, rename and curve changes', async () => {
    const { state, history } = setup();
    state.addPath(new Path({ id: 'b' }));
    await flush();
    state.renamePath('b', 'c');
    await flush();
    history.undo();
    expect(state.paths.map((p) => p.id)).toEqual(['a', 'b']);
    history.undo();
    expect(state.paths.map((p) => p.id)).toEqual(['a']);
  });

  it('restores the selection of the undone change', async () => {
    const { state, history, path } = setup();
    state.select('a', 1);
    path.removeWaypoint(1);
    await flush();
    state.select(null);
    history.undo();
    expect(state.selection).toEqual({ pathId: 'a', waypointIndex: 1, handle: null });
  });

  it('clears redo after a new change and respects the limit', async () => {
    const { history, path } = setup();
    history.limit = 3;
    for (let i = 0; i < 5; i++) {
      path.moveWaypoint(0, [i + 1, 0, 0]);
      await flush();
    }
    let undos = 0;
    while (history.undo()) undos++;
    expect(undos).toBe(3);
    history.redo();
    path.moveWaypoint(1, [0, 9, 0]);
    await flush();
    expect(history.canRedo).toBe(false);
  });

  it('emits change events', async () => {
    const { history, path } = setup();
    const listener = vi.fn();
    history.events.on('change', listener);
    path.moveWaypoint(0, [1, 0, 0]);
    await flush();
    expect(listener).toHaveBeenLastCalledWith({ canUndo: true, canRedo: false });
    history.undo();
    expect(listener).toHaveBeenLastCalledWith({ canUndo: false, canRedo: true });
  });
});

describe('undo shortcuts', () => {
  it('maps Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z and Ctrl+Y by physical key', () => {
    const target = { undo: vi.fn(), redo: vi.fn(), deleteSelectedWaypoint: vi.fn(), clearWaypointSelection: vi.fn(), addWaypoint: vi.fn(), selectAdjacentWaypoint: vi.fn(), shiftSelectedWaypoint: vi.fn(), toggleView: vi.fn() };
    const element = new EventTarget() as unknown as HTMLElement;
    const off = bindShortcuts(target, element);
    const fire = (init: Record<string, unknown>) => {
      const e = Object.assign(new Event('keydown', { cancelable: true }), { ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...init });
      element.dispatchEvent(e);
      return e;
    };
    expect(fire({ code: 'KeyZ', metaKey: true, key: 'я' }).defaultPrevented).toBe(true); // Ukrainian layout
    fire({ code: 'KeyZ', ctrlKey: true });
    fire({ code: 'KeyZ', metaKey: true, shiftKey: true });
    fire({ code: 'KeyY', ctrlKey: true });
    expect(target.undo).toHaveBeenCalledTimes(2);
    expect(target.redo).toHaveBeenCalledTimes(2);
    expect(fire({ code: 'KeyC', metaKey: true }).defaultPrevented).toBe(false); // copy untouched
    expect(target.deleteSelectedWaypoint).not.toHaveBeenCalled();
    off();
  });
});
