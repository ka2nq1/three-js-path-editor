import { Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { Path, PathFollower, createCoordinateSystem, type Vec3 } from '../src';
import { expectVecClose, square } from './helpers';

const out = (): Vec3 => [NaN, NaN, NaN];

const paths = {
  linear: new Path({ curve: 'linear', points: square }),
  'catmull-rom': new Path({ curve: 'catmull-rom', points: square }),
  bezier: new Path({ curve: 'bezier', points: square }),
  centripetal: new Path({ curve: { type: 'catmull-rom', parametrization: 'centripetal' }, points: square }),
  linearHeight: new Path({ curve: { type: 'catmull-rom', linearHeight: true }, points: square }),
};

describe('sampling into an output vector', () => {
  for (const [name, path] of Object.entries(paths)) {
    it(`writes into the vector it is given (${name})`, () => {
      for (const sample of [
        (o?: Vec3) => path.getPoint(0.3, o),
        (o?: Vec3) => path.getPointAt(0.3, o),
        (o?: Vec3) => path.getPointAtDistance(7, o),
        (o?: Vec3) => path.getTangent(0.3, o),
        (o?: Vec3) => path.getTangentAt(0.3, o),
        (o?: Vec3) => path.getTangentAtDistance(7, o),
      ]) {
        const target = out();
        const returned = sample(target);
        expect(returned).toBe(target);
        expectVecClose(target, sample(), 9);
      }
    });
  }

  it('returns a fresh vector when none is given', () => {
    const path = paths.linear;
    expect(path.getPointAtDistance(5)).not.toBe(path.getPointAtDistance(5));
  });

  it('leaves repeated samples independent of each other', () => {
    const path = paths['catmull-rom'];
    const a = out();
    const b = out();
    path.getPointAtDistance(5, a);
    path.getPointAtDistance(25, b);
    expect(a).not.toEqual(b);
    expectVecClose(a, path.getPointAtDistance(5), 9);
  });
});

describe('coordinate conversion into an output vector', () => {
  const coordinates = createCoordinateSystem({ origin: [1, 2, 3], scale: 2 });

  it('writes into the vector it is given', () => {
    for (const convert of [
      (o?: Vec3) => coordinates.toWorld([1, 1, 1], 3, o),
      (o?: Vec3) => coordinates.toPath([3, 4, 5], 3, o),
      (o?: Vec3) => coordinates.directionToWorld([1, 0, 0], 3, o),
    ]) {
      const target = out();
      expect(convert(target)).toBe(target);
      expectVecClose(target, convert(), 9);
    }
  });

  it('keeps the 2D plane and elevation', () => {
    const plane = createCoordinateSystem({ plane2D: 'xz', elevation2D: 4 });
    const target = out();
    plane.toWorld([5, 6, 0], 2, target);
    expectVecClose(target, [5, 4, 6], 9);
  });
});

describe('follower sampling', () => {
  it('still poses the object identically through the out-param path', () => {
    const object = new Object3D();
    const follower = new PathFollower({ object, path: paths['catmull-rom'], speed: 5 });
    follower.update(1);
    expectVecClose(object.position.toArray(), paths['catmull-rom'].getPointAtDistance(5), 6);
  });
});
