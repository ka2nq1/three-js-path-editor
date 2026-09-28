import type { Vec3 } from '../../utils/vec3';
import { clamp } from '../../utils/math';

/**
 * A parametric curve over t in [0, 1]. Segment i spans t in [i / n, (i + 1) / n],
 * so waypoint i always sits exactly at t = i / segmentCount.
 */
export interface Curve {
  readonly segmentCount: number;
  getPoint(t: number): Vec3;
  /** Derivative dP/dt (not normalized). */
  getDerivative(t: number): Vec3;
}

/** Maps global t to [segmentIndex, localT]. */
export function locateSegment(t: number, segmentCount: number): [number, number] {
  const scaled = clamp(t, 0, 1) * segmentCount;
  const index = Math.min(Math.floor(scaled), segmentCount - 1);
  return [index, scaled - index];
}

/** Degenerate curve for paths with 0 or 1 waypoints. */
export class PointCurve implements Curve {
  readonly segmentCount = 0;
  constructor(private readonly point: Vec3 = [0, 0, 0]) {}
  getPoint(): Vec3 {
    return [...this.point];
  }
  getDerivative(): Vec3 {
    return [0, 0, 0];
  }
}
