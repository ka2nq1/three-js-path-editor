import type { Vec3 } from '../../utils/vec3';
import { locateSegmentInto, type Curve, type SegmentLocation } from './Curve';

/** Path-space component the up axis occupies (3D paths are authored Y-up). */
const UP = 1;

/**
 * Wraps a curve and interpolates its up component linearly between waypoints
 * while the other two follow the curve. A spline through points on a surface
 * overshoots in height where a flat stretch runs into a climb (a stair flight,
 * a ramp) and dips below that surface; linear height cannot leave the span
 * between the two waypoints it connects.
 */
export class LinearHeightCurve implements Curve {
  readonly segmentCount: number;
  private readonly location: SegmentLocation = { index: 0, t: 0 };

  constructor(private readonly base: Curve, private readonly points: readonly Vec3[]) {
    this.segmentCount = base.segmentCount;
  }

  getPoint(t: number, out?: Vec3): Vec3 {
    const point = this.base.getPoint(t, out);
    const { index, t: local } = locateSegmentInto(t, this.segmentCount, this.location);
    const a = this.points[index][UP];
    const b = this.points[(index + 1) % this.points.length][UP];
    point[UP] = a + (b - a) * local;
    return point;
  }

  getDerivative(t: number, out?: Vec3): Vec3 {
    const derivative = this.base.getDerivative(t, out);
    const { index } = locateSegmentInto(t, this.segmentCount, this.location);
    const a = this.points[index][UP];
    const b = this.points[(index + 1) % this.points.length][UP];
    derivative[UP] = (b - a) * this.segmentCount;
    return derivative;
  }
}
