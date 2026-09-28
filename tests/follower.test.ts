import { Group, Object3D, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Path, PathCursor, PathFollower, createCoordinateSystem } from '../src';
import { expectVecClose } from './helpers';

const line = () => new Path({ curve: 'linear', points: [[0, 0, 0], [10, 0, 0], [20, 0, 0]] });

const forwardOf = (o: Object3D, local: [number, number, number] = [0, 0, 1]) =>
  new Vector3(...local).applyQuaternion(o.quaternion).toArray();

describe('PathFollower progress', () => {
  it('moves at constant speed and reports progress', () => {
    const object = new Object3D();
    const follower = new PathFollower({ object, path: line(), speed: 5 });
    follower.update(1);
    expect(follower.distance).toBeCloseTo(5);
    expect(follower.progress).toBeCloseTo(0.25);
    expectVecClose(object.position.toArray(), [5, 0, 0]);
    follower.update(2);
    expectVecClose(object.position.toArray(), [15, 0, 0]);
  });

  it('can jump to a progress value and pause/resume', () => {
    const object = new Object3D();
    const follower = new PathFollower({ object, path: line(), speed: 5 });
    follower.setProgress(0.5);
    expectVecClose(object.position.toArray(), [10, 0, 0]);
    follower.pause().update(1);
    expect(follower.progress).toBeCloseTo(0.5);
    follower.play().update(1);
    expect(follower.progress).toBeCloseTo(0.75);
  });

  it('does not move before play when autoPlay is false', () => {
    const follower = new PathFollower({ object: new Object3D(), path: line(), speed: 5, autoPlay: false });
    follower.update(1);
    expect(follower.progress).toBe(0);
  });

  it('applies a speed modifier', () => {
    const follower = new PathFollower({ object: new Object3D(), path: line(), speed: 10, speedModifier: () => 0.5 });
    follower.update(1);
    expect(follower.distance).toBeCloseTo(5);
  });
});

describe('PathFollower completion', () => {
  it('stops at the end and fires complete once', () => {
    const object = new Object3D();
    const onComplete = vi.fn();
    const follower = new PathFollower({ object, path: line(), speed: 15, onComplete });
    follower.update(1);
    follower.update(1);
    follower.update(1);
    expect(follower.isComplete).toBe(true);
    expect(follower.isPlaying).toBe(false);
    expect(follower.progress).toBe(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expectVecClose(object.position.toArray(), [20, 0, 0]);
  });

  it('restarts after completion on play()', () => {
    const follower = new PathFollower({ object: new Object3D(), path: line(), speed: 100 });
    follower.update(1);
    expect(follower.isComplete).toBe(true);
    follower.play();
    expect(follower.progress).toBe(0);
    expect(follower.isPlaying).toBe(true);
  });

  it('reset() returns to the start', () => {
    const object = new Object3D();
    const follower = new PathFollower({ object, path: line(), speed: 5 });
    follower.update(2);
    follower.reset();
    expect(follower.progress).toBe(0);
    expectVecClose(object.position.toArray(), [0, 0, 0]);
  });
});

describe('PathFollower looping', () => {
  it('wraps around in loop mode and counts loops', () => {
    const onLoop = vi.fn();
    const follower = new PathFollower({ object: new Object3D(), path: line(), speed: 25, loop: true, onLoop });
    follower.update(1); // 25 = one lap (20) + 5
    expect(follower.distance).toBeCloseTo(5);
    expect(onLoop).toHaveBeenCalledWith({ count: 1, direction: 1 });
    follower.update(2); // +50 = 2 laps + 10 => 15
    expect(follower.distance).toBeCloseTo(15);
    expect(follower.cursor.loopCount).toBe(3);
    expect(follower.isComplete).toBe(false);
  });

  it('bounces in pingpong mode and faces the travel direction', () => {
    const object = new Object3D();
    const follower = new PathFollower({ object, path: line(), speed: 25, loop: 'pingpong' });
    follower.update(1); // reaches 20, bounces back 5
    expect(follower.distance).toBeCloseTo(15);
    expect(follower.direction).toBe(-1);
    expectVecClose(forwardOf(object), [-1, 0, 0]);
    follower.update(1); // 15 back to 0, bounce 10
    expect(follower.distance).toBeCloseTo(10);
    expect(follower.direction).toBe(1);
  });

  it('fires waypoint events in order, including across loops', () => {
    const cursor = new PathCursor({ path: line(), speed: 1, loop: 'loop' });
    const hits: number[] = [];
    cursor.events.on('waypoint', ({ index }) => hits.push(index));
    cursor.advance(12); // passes wp1 at 10
    cursor.advance(10); // reaches wp2 at 20, wraps to wp0, then 2
    expect(hits).toEqual([1, 2, 0]);
  });

  it('wraps seamlessly on closed paths', () => {
    const path = new Path({ curve: { type: 'linear', closed: true }, points: [[0, 0, 0], [10, 0, 0], [10, 0, 10], [0, 0, 10]] });
    const object = new Object3D();
    const follower = new PathFollower({ object, path, speed: 45, loop: 'loop' });
    follower.update(1);
    expectVecClose(object.position.toArray(), [5, 0, 0]);
  });
});

describe('PathFollower orientation', () => {
  it('aligns +Z with the tangent by default', () => {
    const object = new Object3D();
    const path = new Path({ curve: 'linear', points: [[0, 0, 0], [10, 0, 0], [10, 0, 10]] });
    const follower = new PathFollower({ object, path, speed: 1 });
    follower.setProgress(0.25);
    expectVecClose(forwardOf(object), [1, 0, 0]);
    expectVecClose(forwardOf(object, [0, 1, 0]), [0, 1, 0]); // stays upright
    follower.setProgress(0.75);
    expectVecClose(forwardOf(object), [0, 0, 1]);
  });

  it('supports models with a different forward axis', () => {
    const object = new Object3D();
    const follower = new PathFollower({ object, path: line(), orientation: { forward: [0, 0, -1] } });
    follower.setProgress(0.5);
    expectVecClose(forwardOf(object, [0, 0, -1]), [1, 0, 0]);
  });

  it('pitches along climbing paths unless yawOnly is set', () => {
    const path = new Path({ curve: 'linear', points: [[0, 0, 0], [10, 10, 0]] });
    const a = new Object3D();
    new PathFollower({ object: a, path }).setProgress(0.5);
    expectVecClose(forwardOf(a), [Math.SQRT1_2, Math.SQRT1_2, 0]);
    const b = new Object3D();
    new PathFollower({ object: b, path, orientation: { yawOnly: true } }).setProgress(0.5);
    expectVecClose(forwardOf(b), [1, 0, 0]);
  });

  it('can move without rotating', () => {
    const object = new Object3D();
    new PathFollower({ object, path: line(), orientation: false }).setProgress(0.5);
    expect(object.quaternion.toArray()).toEqual([0, 0, 0, 1]);
  });

  it('compensates for a transformed parent in world space', () => {
    const parent = new Group();
    parent.position.set(100, 0, 0);
    parent.rotation.y = Math.PI / 2;
    const object = new Object3D();
    parent.add(object);
    new PathFollower({ object, path: line() }).setProgress(0.5);
    object.updateWorldMatrix(true, false);
    expectVecClose(object.getWorldPosition(new Vector3()).toArray(), [10, 0, 0]);
    expectVecClose(new Vector3(0, 0, 1).transformDirection(object.matrixWorld).toArray(), [1, 0, 0]);
  });
});

describe('PathFollower with 2D paths', () => {
  it('follows 2D paths on the XZ plane', () => {
    const path = new Path({ dimension: 2, curve: 'linear', points: [[0, 0], [0, 10]] });
    const object = new Object3D();
    new PathFollower({ object, path }).setProgress(0.5);
    expectVecClose(object.position.toArray(), [0, 0, 5]);
    expectVecClose(forwardOf(object), [0, 0, 1]);
  });

  it('respects a custom coordinate system', () => {
    const path = new Path({ dimension: 2, curve: 'linear', points: [[0, 0], [10, 0]] });
    const object = new Object3D();
    const coordinates = createCoordinateSystem({ plane2D: 'xy', elevation2D: -3 });
    new PathFollower({ object, path, coordinates }).setProgress(0.5);
    expectVecClose(object.position.toArray(), [5, 0, -3]);
  });
});
