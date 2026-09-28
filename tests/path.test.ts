import { describe, expect, it, vi } from 'vitest';
import { Path, Waypoint } from '../src/core';
import { expectVecClose, square } from './helpers';

describe('Path creation', () => {
  it('uses sensible defaults', () => {
    const path = new Path();
    expect(path.id).toMatch(/^path-/);
    expect(path.dimension).toBe(3);
    expect(path.curve).toEqual({ type: 'catmull-rom', closed: false, tension: 0.5 });
    expect(path.waypoints).toHaveLength(0);
    expect(path.length).toBe(0);
  });

  it('accepts a curve type string or options', () => {
    expect(new Path({ curve: 'linear' }).curve.type).toBe('linear');
    expect(new Path({ curve: { type: 'bezier', closed: true } }).curve).toEqual({ type: 'bezier', closed: true, tension: 0.5 });
  });

  it('accepts arrays, init objects and Waypoint instances as points', () => {
    const path = new Path({
      points: [[1, 2, 3], { position: [4, 5, 6], metadata: { speed: 2 } }, new Waypoint({ position: [7, 8, 9], id: 'w3' })],
    });
    expect(path.waypoints.map((w) => w.position)).toEqual([
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ]);
    expect(path.waypoints[1].metadata).toEqual({ speed: 2 });
    expect(path.waypoints[2].id).toBe('w3');
  });

  it('handles 0 and 1 waypoint paths without throwing', () => {
    const empty = new Path();
    expect(empty.getPointAt(0.5)).toEqual([0, 0, 0]);
    const single = new Path({ points: [[3, 4, 5]] });
    expect(single.getPointAt(0.7)).toEqual([3, 4, 5]);
    expect(single.length).toBe(0);
  });
});

describe('Waypoint manipulation', () => {
  it('adds, inserts and removes waypoints', () => {
    const path = new Path({ curve: 'linear', points: [[0, 0, 0], [10, 0, 0]] });
    path.addWaypoint([20, 0, 0]);
    path.addWaypoint([5, 0, 0], 1);
    expect(path.waypoints.map((w) => w.position[0])).toEqual([0, 5, 10, 20]);
    const removed = path.removeWaypoint(1);
    expect(removed?.position).toEqual([5, 0, 0]);
    expect(path.removeWaypoint(99)).toBeUndefined();
    expect(path.waypoints).toHaveLength(3);
  });

  it('moves waypoints and invalidates the cached length', () => {
    const path = new Path({ curve: 'linear', points: [[0, 0, 0], [10, 0, 0]] });
    expect(path.length).toBeCloseTo(10);
    path.moveWaypoint(1, [0, 0, 20]);
    expect(path.length).toBeCloseTo(20);
  });

  it('reorders waypoints', () => {
    const path = new Path({ points: square });
    path.reorderWaypoint(0, 3);
    expect(path.waypoints.map((w) => w.position)).toEqual([square[1], square[2], square[3], square[0]]);
    path.reorderWaypoint(3, -5); // clamped to 0
    expect(path.waypoints[0].position).toEqual(square[0]);
  });

  it('reverses direction and swaps bezier handles', () => {
    const path = new Path({
      curve: 'bezier',
      points: [{ position: [0, 0, 0], handleOut: [1, 0, 0] }, { position: [10, 0, 0], handleIn: [-1, 0, 0] }],
    });
    path.reverse();
    expect(path.waypoints[0].position).toEqual([10, 0, 0]);
    expect(path.waypoints[0].handleOut).toEqual([-1, 0, 0]);
    expect(path.waypoints[1].handleIn).toEqual([1, 0, 0]);
  });

  it('emits change events and bumps the version', () => {
    const path = new Path({ points: square });
    const listener = vi.fn();
    path.events.on('change', listener);
    const v = path.version;
    path.moveWaypoint(0, [1, 1, 1]);
    path.setCurve({ closed: true });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(path.version).toBe(v + 2);
  });

  it('reports the distance of every waypoint along the path', () => {
    const path = new Path({ curve: 'linear', points: square });
    const d = path.getWaypointDistances();
    expect(d.map((x) => Math.round(x))).toEqual([0, 10, 20, 30]);
  });

  it('clones deeply', () => {
    const path = new Path({ id: 'a', points: square, metadata: { nested: { x: 1 } } });
    const copy = path.clone({ id: 'b' });
    copy.moveWaypoint(0, [9, 9, 9]);
    (copy.metadata.nested as { x: number }).x = 2;
    expect(path.waypoints[0].position).toEqual([0, 0, 0]);
    expect((path.metadata.nested as { x: number }).x).toBe(1);
    expect(copy.id).toBe('b');
  });
});

describe('2D and 3D paths', () => {
  it('keeps 2D waypoints on the plane (z = 0)', () => {
    const path = new Path({ dimension: 2, points: [[1, 2, 99], [3, 4]] });
    expect(path.waypoints[0].position).toEqual([1, 2, 0]);
    path.moveWaypoint(1, [5, 6, 7]);
    expect(path.waypoints[1].position).toEqual([5, 6, 0]);
    for (let u = 0; u <= 1; u += 0.1) expect(path.getPointAt(u)[2]).toBe(0);
  });

  it('evaluates 3D paths in all axes', () => {
    const path = new Path({ curve: 'linear', points: [[0, 0, 0], [0, 10, 0], [0, 10, 10]] });
    expect(path.length).toBeCloseTo(20);
    expectVecClose(path.getPointAt(0.25), [0, 5, 0]);
    expectVecClose(path.getPointAt(0.75), [0, 10, 5]);
    expectVecClose(path.getTangentAt(0.75), [0, 0, 1]);
  });
});
