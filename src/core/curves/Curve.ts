import { set, type Vec3 } from '../../utils/vec3';
import { clamp } from '../../utils/math';

/**
 * A parametric curve over t in [0, 1]. Segment i spans t in [i / n, (i + 1) / n],
 * so waypoint i always sits exactly at t = i / segmentCount.
 *
 * Both evaluators take an optional output vector: implementations write into it
 * and return it, so sampling a curve every frame allocates nothing. Callers
 * must use the returned value, never assume `out` was written.
 */
export interface Curve {
  readonly segmentCount: number;
  getPoint(t: number, out?: Vec3): Vec3;
  /** Derivative dP/dt (not normalized). */
  getDerivative(t: number, out?: Vec3): Vec3;
}

/** Segment index and local parameter inside it. */
export interface SegmentLocation {
  index: number;
  t: number;
}

/** Maps global t to a segment index and the parameter inside it, without allocating. */
export function locateSegmentInto(t: number, segmentCount: number, out: SegmentLocation): SegmentLocation {
  const scaled = clamp(t, 0, 1) * segmentCount;
  out.index = Math.min(Math.floor(scaled), segmentCount - 1);
  out.t = scaled - out.index;
  return out;
}

const _location: SegmentLocation = { index: 0, t: 0 };

/** Maps global t to [segmentIndex, localT]. Allocates; prefer `locateSegmentInto` in hot paths. */
export function locateSegment(t: number, segmentCount: number): [number, number] {
  locateSegmentInto(t, segmentCount, _location);
  return [_location.index, _location.t];
}

/** Degenerate curve for paths with 0 or 1 waypoints. */
export class PointCurve implements Curve {
  readonly segmentCount = 0;
  constructor(private readonly point: Vec3 = [0, 0, 0]) {}
  getPoint(_t?: number, out?: Vec3): Vec3 {
    return set(out ?? [0, 0, 0], this.point[0], this.point[1], this.point[2]);
  }
  getDerivative(_t?: number, out?: Vec3): Vec3 {
    return set(out ?? [0, 0, 0], 0, 0, 0);
  }
}
