import { add, scale, sub, type Vec3 } from '../../utils/vec3';
import { locateSegment, type Curve } from './Curve';

export interface BezierHandles {
  /** Offset from the waypoint towards the previous waypoint. */
  handleIn: Vec3;
  /** Offset from the waypoint towards the next waypoint. */
  handleOut: Vec3;
}

/**
 * Resolves the effective handles for every waypoint. Explicit handles win;
 * missing ones are derived from neighbours so that an un-edited Bezier path
 * is identical to a Catmull-Rom path with the same tension.
 */
export function resolveBezierHandles(
  points: readonly Vec3[],
  explicit: readonly { handleIn: Vec3 | null; handleOut: Vec3 | null }[],
  closed: boolean,
  tension: number,
): BezierHandles[] {
  const n = points.length;
  return points.map((p, i) => {
    let prev: Vec3;
    let next: Vec3;
    if (closed) {
      prev = points[(i - 1 + n) % n];
      next = points[(i + 1) % n];
    } else {
      prev = i > 0 ? points[i - 1] : sub(scale(p, 2), points[Math.min(1, n - 1)]);
      next = i < n - 1 ? points[i + 1] : sub(scale(p, 2), points[Math.max(n - 2, 0)]);
    }
    const auto = scale(sub(next, prev), tension / 3);
    return {
      handleIn: explicit[i]?.handleIn ?? scale(auto, -1),
      handleOut: explicit[i]?.handleOut ?? auto,
    };
  });
}

/** Piecewise cubic Bezier through every waypoint, shaped by per-waypoint handles. */
export class BezierCurve implements Curve {
  readonly segmentCount: number;

  constructor(
    private readonly points: readonly Vec3[],
    private readonly handles: readonly BezierHandles[],
    readonly closed = false,
  ) {
    this.segmentCount = closed ? points.length : points.length - 1;
  }

  private controls(t: number): [Vec3, Vec3, Vec3, Vec3, number] {
    const [i, s] = locateSegment(t, this.segmentCount);
    const j = (i + 1) % this.points.length;
    const c0 = this.points[i];
    const c3 = this.points[j];
    return [c0, add(c0, this.handles[i].handleOut), add(c3, this.handles[j].handleIn), c3, s];
  }

  getPoint(t: number): Vec3 {
    const [c0, c1, c2, c3, s] = this.controls(t);
    const u = 1 - s;
    const a = u * u * u;
    const b = 3 * u * u * s;
    const c = 3 * u * s * s;
    const d = s * s * s;
    return [
      a * c0[0] + b * c1[0] + c * c2[0] + d * c3[0],
      a * c0[1] + b * c1[1] + c * c2[1] + d * c3[1],
      a * c0[2] + b * c1[2] + c * c2[2] + d * c3[2],
    ];
  }

  getDerivative(t: number): Vec3 {
    const [c0, c1, c2, c3, s] = this.controls(t);
    const u = 1 - s;
    const a = 3 * u * u * this.segmentCount;
    const b = 6 * u * s * this.segmentCount;
    const c = 3 * s * s * this.segmentCount;
    return [
      a * (c1[0] - c0[0]) + b * (c2[0] - c1[0]) + c * (c3[0] - c2[0]),
      a * (c1[1] - c0[1]) + b * (c2[1] - c1[1]) + c * (c3[1] - c2[1]),
      a * (c1[2] - c0[2]) + b * (c2[2] - c1[2]) + c * (c3[2] - c2[2]),
    ];
  }
}
