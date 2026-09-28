import { scale, sub, type Vec3 } from '../../utils/vec3';
import { locateSegment, type Curve } from './Curve';

/**
 * Cardinal / Catmull-Rom spline through every point. `tension` 0.5 matches
 * THREE.CatmullRomCurve3 with curveType 'catmullrom'. Open ends are extrapolated
 * so the curve starts and ends exactly on the first/last point.
 */
export class CatmullRomCurve implements Curve {
  readonly segmentCount: number;

  constructor(
    private readonly points: readonly Vec3[],
    private readonly closed = false,
    private readonly tension = 0.5,
  ) {
    this.segmentCount = closed ? points.length : points.length - 1;
  }

  /** Returns the 4 control points of segment i (with wrap or extrapolation). */
  private controls(i: number): [Vec3, Vec3, Vec3, Vec3] {
    const pts = this.points;
    const n = pts.length;
    const at = (k: number): Vec3 => {
      if (this.closed) return pts[((k % n) + n) % n];
      if (k < 0) return sub(scale(pts[0], 2), pts[1]);
      if (k >= n) return sub(scale(pts[n - 1], 2), pts[n - 2]);
      return pts[k];
    };
    return [at(i - 1), at(i), at(i + 1), at(i + 2)];
  }

  private hermite(t: number, derivative: boolean): Vec3 {
    const [i, s] = locateSegment(t, this.segmentCount);
    const [p0, p1, p2, p3] = this.controls(i);
    const k = this.tension;
    const s2 = s * s;
    const s3 = s2 * s;
    // Hermite basis (or its derivative) with tangents m1 = k(p2 - p0), m2 = k(p3 - p1).
    const h00 = derivative ? 6 * s2 - 6 * s : 2 * s3 - 3 * s2 + 1;
    const h10 = derivative ? 3 * s2 - 4 * s + 1 : s3 - 2 * s2 + s;
    const h01 = derivative ? -6 * s2 + 6 * s : -2 * s3 + 3 * s2;
    const h11 = derivative ? 3 * s2 - 2 * s : s3 - s2;
    const f = derivative ? this.segmentCount : 1;
    const out: Vec3 = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const m1 = k * (p2[c] - p0[c]);
      const m2 = k * (p3[c] - p1[c]);
      out[c] = (h00 * p1[c] + h10 * m1 + h01 * p2[c] + h11 * m2) * f;
    }
    return out;
  }

  getPoint(t: number): Vec3 {
    return this.hermite(t, false);
  }

  getDerivative(t: number): Vec3 {
    return this.hermite(t, true);
  }
}
