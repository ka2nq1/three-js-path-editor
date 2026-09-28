import type { Vec3 } from '../../utils/vec3';
import type { CurveOptions } from '../types';
import { BezierCurve, resolveBezierHandles } from './BezierCurve';
import { CatmullRomCurve } from './CatmullRomCurve';
import { PointCurve, type Curve } from './Curve';
import { LinearCurve } from './LinearCurve';

export * from './Curve';
export * from './LinearCurve';
export * from './CatmullRomCurve';
export * from './BezierCurve';

export interface CurveInputPoint {
  position: Vec3;
  handleIn: Vec3 | null;
  handleOut: Vec3 | null;
}

/** Builds the curve implementation for the given options. */
export function createCurve(points: readonly CurveInputPoint[], options: CurveOptions): Curve {
  if (points.length === 0) return new PointCurve();
  const positions = points.map((p) => p.position);
  if (points.length === 1) return new PointCurve(positions[0]);
  switch (options.type) {
    case 'linear':
      return new LinearCurve(positions, options.closed);
    case 'bezier':
      return new BezierCurve(
        positions,
        resolveBezierHandles(positions, points, options.closed, options.tension),
        options.closed,
      );
    case 'catmull-rom':
    default:
      return new CatmullRomCurve(positions, options.closed, options.tension, options.parametrization);
  }
}
