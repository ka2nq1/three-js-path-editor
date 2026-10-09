import { Group, Object3D, Quaternion, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Path, PathFollower } from '../src';
import { expectVecClose } from './helpers';

const line = () => new Path({ curve: 'linear', points: [[0, 0, 0], [10, 0, 0], [20, 0, 0]] });
const forwardOf = (o: Object3D) => new Vector3(0, 0, 1).applyQuaternion(o.quaternion);

describe('startFrom: closest', () => {
  it('starts at the point on the path nearest the object', () => {
    const object = new Object3D();
    object.position.set(12, 0, 5);
    const follower = new PathFollower({ object, path: line(), speed: 5, startFrom: 'closest' });
    expect(follower.distance).toBeCloseTo(12, 2);
    expectVecClose(object.position.toArray(), [12, 0, 0], 2);
  });

  it('accounts for the parent transform of the object', () => {
    const parent = new Group();
    parent.position.set(0, 0, 5);
    const object = new Object3D();
    object.position.set(8, 0, 0);
    parent.add(object);
    const follower = new PathFollower({ object, path: line(), startFrom: 'closest' });
    expect(follower.distance).toBeCloseTo(8, 2);
  });
});

describe('startFrom: object', () => {
  it('runs a lead-in leg onto the path, then travels it', () => {
    const object = new Object3D();
    object.position.set(0, 0, -10);
    const onEnter = vi.fn();
    const follower = new PathFollower({ object, path: line(), speed: 5, startFrom: 'object', onEnter });
    expect(follower.isEntering).toBe(true);
    expectVecClose(object.position.toArray(), [0, 0, -10]);

    follower.update(1);
    expect(follower.isEntering).toBe(true);
    expect(follower.distance).toBe(0);
    expectVecClose(object.position.toArray(), [0, 0, -5]);

    follower.update(1);
    expect(follower.isEntering).toBe(false);
    expect(onEnter).toHaveBeenCalledTimes(1);
    expectVecClose(object.position.toArray(), [0, 0, 0]);

    follower.update(1);
    expectVecClose(object.position.toArray(), [5, 0, 0]);
  });

  it('spends the leftover time of the arriving frame on the path', () => {
    const object = new Object3D();
    object.position.set(0, 0, -10);
    const follower = new PathFollower({ object, path: line(), speed: 5, startFrom: 'object' });
    follower.update(1);
    follower.update(1.5);
    expect(follower.isEntering).toBe(false);
    expect(follower.distance).toBeCloseTo(2.5);
  });

  it('faces along the lead-in while running it', () => {
    const object = new Object3D();
    object.position.set(0, 0, -10);
    const follower = new PathFollower({ object, path: line(), speed: 5, startFrom: 'object' });
    follower.update(0.5);
    expectVecClose(forwardOf(object).toArray(), [0, 0, 1], 3);
    follower.update(2);
    expectVecClose(forwardOf(object).toArray(), [1, 0, 0], 3);
  });

  it('does not advance the lead-in while paused', () => {
    const object = new Object3D();
    object.position.set(0, 0, -10);
    const follower = new PathFollower({ object, path: line(), speed: 5, startFrom: 'object', autoPlay: false });
    follower.update(1);
    expect(follower.isEntering).toBe(true);
    expectVecClose(object.position.toArray(), [0, 0, -10]);
    follower.play().update(1);
    expectVecClose(object.position.toArray(), [0, 0, -5]);
  });

  it('starts on the path when the object already stands on it', () => {
    const object = new Object3D();
    const follower = new PathFollower({ object, path: line(), speed: 5, startFrom: 'object' });
    expect(follower.isEntering).toBe(false);
  });

  it('reset drops the lead-in', () => {
    const object = new Object3D();
    object.position.set(0, 0, -10);
    const follower = new PathFollower({ object, path: line(), speed: 5, startFrom: 'object' });
    follower.reset();
    expect(follower.isEntering).toBe(false);
    expectVecClose(object.position.toArray(), [0, 0, 0]);
  });
});

describe('initialRotation', () => {
  const facingBack = () => {
    const object = new Object3D();
    object.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
    return object;
  };

  it('snaps onto the path heading by default', () => {
    const object = facingBack();
    const follower = new PathFollower({
      object,
      path: line(),
      speed: 5,
      orientation: { smoothing: 8, yawOnly: true },
    });
    follower.update(0.1);
    expectVecClose(forwardOf(object).toArray(), [1, 0, 0], 3);
  });

  it('eases from the rotation the object already has', () => {
    const object = facingBack();
    const follower = new PathFollower({
      object,
      path: line(),
      speed: 5,
      initialRotation: 'object',
      orientation: { smoothing: 8, yawOnly: true },
    });
    const before = object.quaternion.clone();
    follower.update(0.1);
    expect(object.quaternion.angleTo(before)).toBeGreaterThan(0);
    expect(object.quaternion.angleTo(before)).toBeLessThan(Math.PI / 2);
  });

  it('seedRotation does the same at any time', () => {
    const object = new Object3D();
    const follower = new PathFollower({ object, path: line(), speed: 5, orientation: { smoothing: 8 } });
    const sideways = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    follower.seedRotation(sideways);
    follower.update(0.05);
    expect(object.quaternion.angleTo(sideways)).toBeLessThan(Math.PI / 4);
  });
});
