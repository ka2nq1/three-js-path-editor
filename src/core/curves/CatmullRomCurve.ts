import { scale, sub, type Vec3 } from '../../utils/vec3';
import type { CatmullRomParametrization } from '../types';
import { locateSegment, type Curve } from './Curve';

/**
 * Cardinal / Catmull-Rom spline through every point. 'uniform' with `tension`
 * 0.5 matches THREE.CatmullRomCurve3 with curveType 'catmullrom'; 'centripetal'
 * and 'chordal' match the curve types of the same name. Open ends are
 * extrapolated so the curve starts and ends exactly on the first/last point.
 */
export class CatmullRomCurve implements Curve {
  readonly segmentCount: number;

  constructor(
    private readonly points: readonly Vec3[],
    private readonly closed = false,
    private readonly tension = 0.5,
    private readonly parametrization: CatmullRomParametrization = 'uniform',
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
    const [m1, m2] = this.tangents(p0, p1, p2, p3);
    const s2 = s * s;
    const s3 = s2 * s;
    // Hermite basis (or its derivative) with segment tangents m1, m2.
    const h00 = derivative ? 6 * s2 - 6 * s : 2 * s3 - 3 * s2 + 1;
    const h10 = derivative ? 3 * s2 - 4 * s + 1 : s3 - 2 * s2 + s;
    const h01 = derivative ? -6 * s2 + 6 * s : -2 * s3 + 3 * s2;
    const h11 = derivative ? 3 * s2 - 2 * s : s3 - s2;
    const f = derivative ? this.segmentCount : 1;
    const out: Vec3 = [0, 0, 0];
    for (let c = 0; c < 3; c++) out[c] = (h00 * p1[c] + h10 * m1[c] + h01 * p2[c] + h11 * m2[c]) * f;
    return out;
  }

  /**
   * Segment end tangents (in segment parameter units). Uniform: tension-scaled
   * central differences. Centripetal/chordal: the non-uniform Catmull-Rom of
   * THREE.CatmullRomCurve3, knots spaced by distance^0.5 / distance^1.
   */
  private tangents(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3): [Vec3, Vec3] {
    if (this.parametrization === 'uniform') {
      const k = this.tension;
      return [scale(sub(p2, p0), k), scale(sub(p3, p1), k)];
    }
    const power = this.parametrization === 'chordal' ? 0.5 : 0.25;
    let dt1 = distanceSq(p1, p2) ** power;
    let dt0 = distanceSq(p0, p1) ** power;
    let dt2 = distanceSq(p2, p3) ** power;
    if (dt1 < 1e-4) dt1 = 1;
    if (dt0 < 1e-4) dt0 = dt1;
    if (dt2 < 1e-4) dt2 = dt1;
    const m1: Vec3 = [0, 0, 0];
    const m2: Vec3 = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      m1[c] = ((p1[c] - p0[c]) / dt0 - (p2[c] - p0[c]) / (dt0 + dt1) + (p2[c] - p1[c]) / dt1) * dt1;
      m2[c] = ((p2[c] - p1[c]) / dt1 - (p3[c] - p1[c]) / (dt1 + dt2) + (p3[c] - p2[c]) / dt2) * dt1;
    }
    return [m1, m2];
  }

  getPoint(t: number): Vec3 {
    return this.hermite(t, false);
  }

  getDerivative(t: number): Vec3 {
    return this.hermite(t, true);
  }
}

function distanceSq(a: Vec3, b: Vec3): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}
