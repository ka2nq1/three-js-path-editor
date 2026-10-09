import { Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Path, PathFollower } from '../src';
import { expectVecClose } from './helpers';

const line = () => new Path({ curve: 'linear', points: [[0, 0, 0], [20, 0, 0]] });
const forwardOf = (o: Object3D) => new Vector3(0, 0, 1).applyQuaternion(o.quaternion);

describe('riders', () => {
  it('trail the leader by their offset', () => {
    const lead = new Object3D();
    const follower = new PathFollower({ object: lead, path: line(), speed: 5 });
    const second = follower.addRider({ object: new Object3D(), offset: 5 });
    const third = follower.addRider({ object: new Object3D(), offset: -2 });
    follower.update(2);
    expectVecClose(lead.position.toArray(), [10, 0, 0]);
    expectVecClose(second.object.position.toArray(), [5, 0, 0]);
    expectVecClose(third.object.position.toArray(), [12, 0, 0]);
  });

  it('clamp to the ends of a non-looping path', () => {
    const follower = new PathFollower({ object: new Object3D(), path: line(), speed: 5 });
    const rider = follower.addRider({ object: new Object3D(), offset: 8 });
    expectVecClose(rider.object.position.toArray(), [0, 0, 0]);
    follower.update(1);
    expectVecClose(rider.object.position.toArray(), [0, 0, 0]);
    follower.update(1);
    expectVecClose(rider.object.position.toArray(), [2, 0, 0]);
  });

  it('wrap around a looping path', () => {
    const follower = new PathFollower({ object: new Object3D(), path: line(), speed: 5, loop: true });
    const rider = follower.addRider({ object: new Object3D(), offset: 8 });
    follower.update(1);
    expectVecClose(rider.object.position.toArray(), [17, 0, 0]);
  });

  it('take a sideways and upwards offset in the path frame', () => {
    const follower = new PathFollower({ object: new Object3D(), path: line(), speed: 5 });
    const wing = follower.addRider({ object: new Object3D(), offset: 4, lateral: [2, 1] });
    follower.update(2);
    // Travelling +X with Y up, the right-hand side is -Z.
    expectVecClose(wing.object.position.toArray(), [6, 1, -2]);
  });

  it('follow the path heading, or keep their own when orientation is off', () => {
    const follower = new PathFollower({ object: new Object3D(), path: line(), speed: 5 });
    const turning = follower.addRider({ object: new Object3D(), offset: 2 });
    const fixed = follower.addRider({ object: new Object3D(), offset: 2, orientation: false });
    follower.update(1);
    expectVecClose(forwardOf(turning.object).toArray(), [1, 0, 0], 3);
    expectVecClose(forwardOf(fixed.object).toArray(), [0, 0, 1], 3);
  });

  it('share the cursor of the leader, with no second speed integration', () => {
    const follower = new PathFollower({ object: new Object3D(), path: line(), speed: 5 });
    follower.addRider({ object: new Object3D(), offset: 3 });
    follower.update(1);
    expect(follower.distance).toBeCloseTo(5);
    expect(follower.riders).toHaveLength(1);
  });

  it('stop being posed once removed', () => {
    const follower = new PathFollower({ object: new Object3D(), path: line(), speed: 5 });
    const rider = follower.addRider({ object: new Object3D(), offset: 5 });
    follower.update(2);
    follower.removeRider(rider);
    follower.update(1);
    expect(follower.riders).toHaveLength(0);
    expectVecClose(rider.object.position.toArray(), [5, 0, 0]);
  });

  it('can be declared with the follower', () => {
    const rider = new Object3D();
    const follower = new PathFollower({
      object: new Object3D(),
      path: line(),
      speed: 5,
      riders: [{ object: rider, offset: 5 }],
    });
    follower.update(2);
    expect(follower.riders).toHaveLength(1);
    expectVecClose(rider.position.toArray(), [5, 0, 0]);
  });
});
