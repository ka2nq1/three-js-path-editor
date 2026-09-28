import { describe, expect, it, vi } from 'vitest';
import { Path } from '../src/core';
import { EditorState, insertWaypointAfter, shiftWaypoint, suggestWaypointPosition } from '../src/editor';
import { expectVecClose } from './helpers';

const make = (id = 'a') => new Path({ id, curve: 'linear', points: [[0, 0, 0], [10, 0, 0], [20, 0, 0]] });

describe('EditorState', () => {
  it('manages paths and selection', () => {
    const state = new EditorState();
    const onSelect = vi.fn();
    state.events.on('selection', onSelect);
    state.addPath(make('a'));
    state.addPath(make('b'));
    state.select('b', 1);
    expect(state.selection).toEqual({ pathId: 'b', waypointIndex: 1, handle: null });
    expect(state.selectedPath?.id).toBe('b');
    state.select('b', 1); // no-op
    expect(onSelect).toHaveBeenCalledTimes(1);
    state.select('missing', 2);
    expect(state.selection.pathId).toBeNull();
  });

  it('clamps the selection when waypoints are removed', () => {
    const state = new EditorState();
    const path = make();
    state.addPath(path);
    state.select('a', 2);
    path.removeWaypoint(2);
    expect(state.selection.waypointIndex).toBe(1);
  });

  it('clears the selection when the selected path is removed', () => {
    const state = new EditorState();
    state.addPath(make());
    state.select('a', 0);
    state.removePath('a');
    expect(state.selection).toEqual({ pathId: null, waypointIndex: null, handle: null });
  });

  it('renames paths and rejects duplicates', () => {
    const state = new EditorState();
    state.addPath(make('a'));
    state.addPath(make('b'));
    state.select('a');
    expect(state.renamePath('a', 'b')).toBe(false);
    expect(state.renamePath('a', 'c')).toBe(true);
    expect(state.paths.map((p) => p.id)).toEqual(['c', 'b']);
    expect(state.selection.pathId).toBe('c');
  });

  it('toggles view options', () => {
    const state = new EditorState({ grid: true });
    const onView = vi.fn();
    state.events.on('view', onView);
    expect(state.toggleView('grid')).toBe(false);
    state.setView({ labels: true, debug: false });
    expect(state.view.labels).toBe(true);
    expect(onView).toHaveBeenCalledTimes(2);
  });
});

describe('point operations', () => {
  it('inserts between points on the curve and extrapolates at the end', () => {
    const path = make();
    expectVecClose(suggestWaypointPosition(path, 0), [5, 0, 0]);
    expectVecClose(suggestWaypointPosition(path, 2), [30, 0, 0]);
    expect(insertWaypointAfter(path, 0)).toBe(1);
    expect(path.waypoints.map((w) => w.position[0])).toEqual([0, 5, 10, 20]);
    expect(insertWaypointAfter(path, null, [99, 0, 0])).toBe(4);
  });

  it('shifts waypoints within bounds', () => {
    const path = make();
    expect(shiftWaypoint(path, 0, -1)).toBe(0);
    expect(shiftWaypoint(path, 0, 1)).toBe(1);
    expect(path.waypoints[1].position).toEqual([0, 0, 0]);
  });
});
