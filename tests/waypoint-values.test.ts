import { Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Path, PathCursor, PathFollower, parsePathFile, serializePaths, PathFormatError } from '../src';
import { insertWaypointAtT } from '../src/editor';
import { expectVecClose } from './helpers';

const line = (points: { position: number[]; speed?: number; roll?: number }[], closed = false) =>
  new Path({ curve: { type: 'linear', closed }, points });

describe('per-waypoint speed and roll: data', () => {
  it('round-trips speed and roll in JSON and validates them', () => {
    const data = {
      version: 1,
      paths: [{ id: 'a', dimension: 3, curve: { type: 'linear', closed: false, tension: 0.5 }, points: [{ position: [0, 0, 0], speed: 0.5, roll: 20 }, { position: [1, 0, 0] }], metadata: {} }],
    };
    const [path] = parsePathFile(data);
    expect(path.waypoints[0].speed).toBe(0.5);
    expect(path.waypoints[0].roll).toBe(20);
    expect(path.waypoints[1].speed).toBeUndefined();
    expect(serializePaths([path])).toEqual(data);
    const bad = structuredClone(data) as { paths: { points: Record<string, unknown>[] }[] };
    bad.paths[0].points[0].roll = 'steep';
    expect(() => parsePathFile(bad)).toThrow(PathFormatError);
  });

  it('sets and clears waypoint properties', () => {
    const path = line([{ position: [0, 0, 0] }, { position: [10, 0, 0] }]);
    path.setWaypointProperties(1, { speed: 2, roll: -15 });
    expect([path.waypoints[1].speed, path.waypoints[1].roll]).toEqual([2, -15]);
    path.setWaypointProperties(1, { speed: null });
    expect(path.waypoints[1].speed).toBeUndefined();
    expect(path.waypoints[1].roll).toBe(-15);
  });

  it('interpolates values between waypoints (step / linear / smooth)', () => {
    const path = line([{ position: [0, 0, 0], roll: 0 }, { position: [10, 0, 0], roll: 40 }, { position: [20, 0, 0] }]);
    expect(path.getWaypointValueAtDistance('roll', 5, 'step')).toBe(0);
    expect(path.getWaypointValueAtDistance('roll', 5, 'linear')).toBeCloseTo(20);
    expect(path.getWaypointValueAtDistance('roll', 2.5, 'linear')).toBeCloseTo(10);
    expect(path.getWaypointValueAtDistance('roll', 2.5, 'smooth')).toBeCloseTo(40 * 0.15625);
    expect(path.getWaypointValueAtDistance('roll', 10, 'smooth')).toBeCloseTo(40);
    expect(path.getWaypointValueAtDistance('roll', 15, 'linear')).toBeCloseTo(20); // towards default 0
    expect(path.getWaypointValueAtDistance('speed', 15, 'linear')).toBe(1); // default everywhere
  });

  it('blends the closing segment of closed paths back to the first waypoint', () => {
    const path = line([{ position: [0, 0, 0], speed: 1 }, { position: [10, 0, 0], speed: 3 }], true);
    // Segment 1 runs from wp1 (speed 3) back to wp0 (speed 1).
    expect(path.getWaypointValueAtDistance('speed', 15, 'linear')).toBeCloseTo(2);
  });

  it('finds the closest point on the curve', () => {
    const path = new Path({ points: [[0, 0, 0], [10, 0, 0], [20, 0, 10]] });
    const target = path.getPoint(0.3);
    const hit = path.getClosestPoint([target[0], target[1] + 1e-3, target[2]]);
    expect(hit.t).toBeCloseTo(0.3, 4);
    expect(hit.distance).toBeLessThan(2e-3);
  });
});

describe('per-waypoint speed: movement', () => {
  it('uses the segment speed with step interpolation', () => {
    const path = line([{ position: [0, 0, 0], speed: 2 }, { position: [10, 0, 0] }, { position: [20, 0, 0] }]);
    const cursor = new PathCursor({ path, speed: 1, interpolation: 'step' });
    cursor.advance(5);
    expect(cursor.distance).toBeCloseTo(10, 1);
    cursor.advance(5);
    expect(cursor.distance).toBeCloseTo(15, 1);
  });

  it('accelerates smoothly with linear interpolation', () => {
    // v(x) = 1 + 0.2x  =>  x(t) = 5(e^(0.2t) - 1)
    const path = line([{ position: [0, 0, 0], speed: 1 }, { position: [10, 0, 0], speed: 3 }]);
    const cursor = new PathCursor({ path, speed: 1, interpolation: 'linear' });
    cursor.advance(2);
    expect(cursor.distance).toBeCloseTo(5 * (Math.exp(0.4) - 1), 1);
    expect(cursor.currentSpeed).toBeCloseTo(1 + 0.2 * cursor.distance, 5);
  });

  it('never stalls on a zero speed waypoint', () => {
    const path = line([{ position: [0, 0, 0], speed: 0 }, { position: [10, 0, 0] }]);
    const cursor = new PathCursor({ path, speed: 1 });
    cursor.advance(1);
    expect(cursor.distance).toBeGreaterThan(0);
  });

  it('can ignore waypoint speeds', () => {
    const path = line([{ position: [0, 0, 0], speed: 3 }, { position: [10, 0, 0], speed: 3 }]);
    const cursor = new PathCursor({ path, speed: 1, useWaypointSpeed: false });
    cursor.advance(2);
    expect(cursor.distance).toBeCloseTo(2);
  });
});

describe('per-waypoint roll: orientation', () => {
  const upOf = (o: Object3D) => new Vector3(0, 1, 0).applyQuaternion(o.quaternion).toArray();
  const fwdOf = (o: Object3D) => new Vector3(0, 0, 1).applyQuaternion(o.quaternion).toArray();

  it('banks right for positive roll, keeping the forward direction', () => {
    const path = line([{ position: [0, 0, 0], roll: 90 }, { position: [10, 0, 0], roll: 90 }]);
    const object = new Object3D();
    const follower = new PathFollower({ object, path });
    follower.setProgress(0.5);
    expectVecClose(fwdOf(object), [1, 0, 0]);
    // Facing +X, the object's right side is +Z; banking right tilts up towards +Z.
    expectVecClose(upOf(object), [0, 0, 1]);
    expect(follower.currentRoll).toBeCloseTo(90);
  });

  it('interpolates roll between waypoints and respects rollScale / applyRoll', () => {
    const path = line([{ position: [0, 0, 0] }, { position: [10, 0, 0], roll: 60 }]);
    const a = new Object3D();
    new PathFollower({ object: a, path, interpolation: 'linear' }).setProgress(0.5); // 30°
    expectVecClose(upOf(a), [0, Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)]);
    const b = new Object3D();
    new PathFollower({ object: b, path, interpolation: 'linear', orientation: { rollScale: 2 } }).setProgress(0.5); // 60°
    expectVecClose(upOf(b), [0, 0.5, Math.sin(Math.PI / 3)]);
    const c = new Object3D();
    new PathFollower({ object: c, path, orientation: { applyRoll: false } }).setProgress(0.5);
    expectVecClose(upOf(c), [0, 1, 0]);
  });

  it('mirrors the bank when travelling backwards', () => {
    const path = line([{ position: [0, 0, 0], roll: 90 }, { position: [10, 0, 0], roll: 90 }]);
    const object = new Object3D();
    const follower = new PathFollower({ object, path, speed: 15, loop: 'pingpong' });
    follower.update(1); // bounced, now heading -X
    expectVecClose(fwdOf(object), [-1, 0, 0]);
    // Facing -X the right side is -Z; the mirrored bank (-90°) tilts up towards +Z,
    // i.e. the same physical tilt as on the way out.
    expectVecClose(upOf(object), [0, 0, 1]);
  });
});

describe('insert waypoint on the curve', () => {
  it('inserts between the right waypoints at the clicked spot', () => {
    const path = new Path({ points: [[0, 0, 0], [10, 0, 0], [20, 0, 10]] });
    const expected = path.getPoint(0.75);
    const index = insertWaypointAtT(path, 0.75);
    expect(index).toBe(2);
    expectVecClose(path.waypoints[2].position, expected);
    expect(path.waypoints).toHaveLength(4);
  });

  it('keeps a Bezier curve exactly the same shape', () => {
    const path = new Path({
      curve: 'bezier',
      points: [{ position: [0, 0, 0], handleOut: [3, 6, 0] }, { position: [10, 0, 0] }, { position: [20, 0, 10] }],
    });
    const before = path.getSpacedPoints(60);
    insertWaypointAtT(path, 0.3);
    insertWaypointAtT(path, 0.9);
    for (const p of before) expect(path.getClosestPoint(p).distance).toBeLessThan(1e-4);
    for (const p of path.getSpacedPoints(60)) expect(path.getClosestPoint(p).distance).toBeLessThan(1e-4);
  });

  it('interpolates speed and roll for the new waypoint', () => {
    const path = line([{ position: [0, 0, 0], speed: 1, roll: 0 }, { position: [10, 0, 0], speed: 3, roll: 20 }]);
    const index = insertWaypointAtT(path, 0.5);
    expect(path.waypoints[index].speed).toBeCloseTo(2);
    expect(path.waypoints[index].roll).toBeCloseTo(10);
  });

  it('inserts on the closing segment of closed paths', () => {
    const path = line([{ position: [0, 0, 0] }, { position: [10, 0, 0] }, { position: [10, 0, 10] }], true);
    const index = insertWaypointAtT(path, 5 / 6);
    expect(index).toBe(3);
    expect(path.waypoints).toHaveLength(4);
  });
});
