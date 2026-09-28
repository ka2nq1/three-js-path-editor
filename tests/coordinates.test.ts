import { describe, expect, it } from 'vitest';
import { createCoordinateSystem, defaultCoordinateSystem } from '../src/core';

describe('CoordinateSystem', () => {
  it('maps 3D paths 1:1 by default', () => {
    expect(defaultCoordinateSystem.toWorld([1, 2, 3], 3)).toEqual([1, 2, 3]);
    expect(defaultCoordinateSystem.toPath([1, 2, 3], 3)).toEqual([1, 2, 3]);
  });

  it('places 2D paths on the XZ ground plane by default', () => {
    expect(defaultCoordinateSystem.toWorld([4, 5, 0], 2)).toEqual([4, 0, 5]);
    expect(defaultCoordinateSystem.toPath([4, 9, 5], 2)).toEqual([4, 5, 0]);
    expect(defaultCoordinateSystem.planeNormal).toEqual([0, 1, 0]);
  });

  it('supports the XY plane, elevation, origin and scale', () => {
    const cs = createCoordinateSystem({ plane2D: 'xy', elevation2D: 2, origin: [10, 0, 0], scale: 2 });
    expect(cs.toWorld([1, 1, 0], 2)).toEqual([12, 2, 2]);
    expect(cs.toPath([12, 2, 2], 2)).toEqual([1, 1, 0]);
    expect(cs.toWorld([1, 1, 1], 3)).toEqual([12, 2, 2]);
    expect(cs.directionToWorld([1, 0, 0], 2)).toEqual([2, 0, 0]);
    expect(cs.planeNormal).toEqual([0, 0, 1]);
  });
});
