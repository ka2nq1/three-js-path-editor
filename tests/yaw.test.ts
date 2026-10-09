import { Euler, Object3D, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Orienter, Path, PathFollower } from '../src';

const line = (to: [number, number, number]) => new Path({ curve: 'linear', points: [[0, 0, 0], to] });

describe('Orienter yaw', () => {
  it('round-trips headings all the way round, including past ±90°', () => {
    const orienter = new Orienter({ yawOnly: true });
    const target = new Quaternion();
    for (const yaw of [0, 0.3, Math.PI / 2, 2.5, 3, -2.5, -Math.PI / 2]) {
      expect(orienter.yawTo(yaw, target)).toBe(true);
      expect(orienter.yawOf(target)).toBeCloseTo(yaw, 6);
    }
  });

  it('round-trips for a model that faces another axis', () => {
    const orienter = new Orienter({ forward: [1, 0, 0], yawOnly: true });
    const target = new Quaternion();
    orienter.yawTo(2.5, target);
    expect(orienter.yawOf(target)).toBeCloseTo(2.5, 6);
    expect(new Vector3(1, 0, 0).applyQuaternion(target).z).toBeCloseTo(Math.cos(2.5), 6);
  });

  it('is what Euler.y cannot be: XYZ order mirrors a heading past ±90°', () => {
    const orienter = new Orienter({ yawOnly: true });
    const target = new Quaternion();
    orienter.yawTo(2.5, target);
    const euler = new Euler().setFromQuaternion(target, 'XYZ');
    expect(euler.y).toBeCloseTo(Math.PI - 2.5, 6);
    expect(Math.abs(euler.x)).toBeCloseTo(Math.PI, 6);
    expect(orienter.yawOf(target)).toBeCloseTo(2.5, 6);
  });

  it('measures the yaw of a world up other than +Y', () => {
    const orienter = new Orienter({ worldUp: [0, 0, 1], up: [0, 0, 1], forward: [1, 0, 0], yawOnly: true });
    const target = new Quaternion();
    orienter.yawTo(1.2, target);
    expect(orienter.yawOf(target)).toBeCloseTo(1.2, 6);
  });
});

describe('PathFollower yaw', () => {
  it('reads the heading the follower put the object on', () => {
    const object = new Object3D();
    const follower = new PathFollower({ object, path: line([-10, 0, -10]), orientation: { yawOnly: true } });
    const expected = Math.atan2(-1, -1);
    expect(follower.yaw).toBeCloseTo(expected, 6);
    expect(object.rotation.y).not.toBeCloseTo(expected, 3);
  });

  it('setYaw faces the object and smoothing eases on from there', () => {
    const object = new Object3D();
    const follower = new PathFollower({
      object,
      path: line([10, 0, 0]),
      speed: 5,
      orientation: { yawOnly: true, smoothing: 8 },
    });
    follower.setYaw(-2.5);
    expect(follower.yaw).toBeCloseTo(-2.5, 6);
    follower.update(0.1);
    const eased = follower.yaw;
    expect(eased).not.toBeCloseTo(-2.5, 3);
    expect(Math.abs(eased)).toBeGreaterThan(0.2);
  });
});
