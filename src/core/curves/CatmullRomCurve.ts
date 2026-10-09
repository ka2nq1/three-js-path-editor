import { set, type Vec3 } from '../../utils/vec3';
import type { CatmullRomParametrization } from '../types';
import { locateSegmentInto, type Curve, type SegmentLocation } from './Curve';

/**
 * Cardinal / Catmull-Rom spline through every point. 'uniform' with `tension`
 * 0.5 matches THREE.CatmullRomCurve3 with curveType 'catmullrom'; 'centripetal'
 * and 'chordal' match the curve types of the same name. Open ends are
 * extrapolated so the curve starts and ends exactly on the first/last point.
 */
export class CatmullRomCurve implements Curve {
  readonly segmentCount: number;
  private readonly location: SegmentLocation = { index: 0, t: 0 };
  // Control points of the current segment: references to `points`, except the
  // extrapolated ends, which are built in the two scratch vectors.
  private readonly control: [Vec3, Vec3, Vec3, Vec3] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  private readonly before: Vec3 = [0, 0, 0];
  private readonly after: Vec3 = [0, 0, 0];
  private readonly m1: Vec3 = [0, 0, 0];
  private readonly m2: Vec3 = [0, 0, 0];

  constructor(
    private readonly points: readonly Vec3[],
    private readonly closed = false,
    private readonly tension = 0.5,
    private readonly parametrization: CatmullRomParametrization = 'uniform',
  ) {
    this.segmentCount = closed ? points.length : points.length - 1;
  }

  /** Fills `control` with the 4 control points of segment i (wrapped or extrapolated). */
  private controls(i: number): void {
    const pts = this.points;
    const n = pts.length;
    const at = (k: number): Vec3 => {
      if (this.closed) return pts[((k % n) + n) % n];
      if (k < 0) return extrapolate(pts[0], pts[1], this.before);
      if (k >= n) return extrapolate(pts[n - 1], pts[n - 2], this.after);
      return pts[k];
    };
    this.control[0] = at(i - 1);
    this.control[1] = at(i);
    this.control[2] = at(i + 1);
    this.control[3] = at(i + 2);
  }

  private hermite(t: number, derivative: boolean, out?: Vec3): Vec3 {
    const { index, t: s } = locateSegmentInto(t, this.segmentCount, this.location);
    this.controls(index);
    const [, p1, p2] = this.control;
    const [m1, m2] = this.tangents();
    const s2 = s * s;
    const s3 = s2 * s;
    // Hermite basis (or its derivative) with segment tangents m1, m2.
    const h00 = derivative ? 6 * s2 - 6 * s : 2 * s3 - 3 * s2 + 1;
    const h10 = derivative ? 3 * s2 - 4 * s + 1 : s3 - 2 * s2 + s;
    const h01 = derivative ? -6 * s2 + 6 * s : -2 * s3 + 3 * s2;
    const h11 = derivative ? 3 * s2 - 2 * s : s3 - s2;
    const f = derivative ? this.segmentCount : 1;
    const target = out ?? ([0, 0, 0] as Vec3);
    for (let c = 0; c < 3; c++) target[c] = (h00 * p1[c] + h10 * m1[c] + h01 * p2[c] + h11 * m2[c]) * f;
    return target;
  }

  /**
   * Segment end tangents (in segment parameter units) for the control points
   * currently in `control`. Uniform: tension-scaled central differences.
   * Centripetal/chordal: the non-uniform Catmull-Rom of
   * THREE.CatmullRomCurve3, knots spaced by distance^0.5 / distance^1.
   */
  private tangents(): [Vec3, Vec3] {
    const [p0, p1, p2, p3] = this.control;
    const { m1, m2 } = this;
    if (this.parametrization === 'uniform') {
      const k = this.tension;
      set(m1, (p2[0] - p0[0]) * k, (p2[1] - p0[1]) * k, (p2[2] - p0[2]) * k);
      set(m2, (p3[0] - p1[0]) * k, (p3[1] - p1[1]) * k, (p3[2] - p1[2]) * k);
      return [m1, m2];
    }
    const power = this.parametrization === 'chordal' ? 0.5 : 0.25;
    let dt1 = distanceSq(p1, p2) ** power;
    let dt0 = distanceSq(p0, p1) ** power;
    let dt2 = distanceSq(p2, p3) ** power;
    if (dt1 < 1e-4) dt1 = 1;
    if (dt0 < 1e-4) dt0 = dt1;
    if (dt2 < 1e-4) dt2 = dt1;
    for (let c = 0; c < 3; c++) {
      m1[c] = ((p1[c] - p0[c]) / dt0 - (p2[c] - p0[c]) / (dt0 + dt1) + (p2[c] - p1[c]) / dt1) * dt1;
      m2[c] = ((p2[c] - p1[c]) / dt1 - (p3[c] - p1[c]) / (dt1 + dt2) + (p3[c] - p2[c]) / dt2) * dt1;
    }
    return [m1, m2];
  }

  getPoint(t: number, out?: Vec3): Vec3 {
    return this.hermite(t, false, out);
  }

  getDerivative(t: number, out?: Vec3): Vec3 {
    return this.hermite(t, true, out);
  }
}

/** Mirrors `inner` through `end`, the virtual control point past an open end. */
function extrapolate(end: Vec3, inner: Vec3, out: Vec3): Vec3 {
  return set(out, end[0] * 2 - inner[0], end[1] * 2 - inner[1], end[2] * 2 - inner[2]);
}

function distanceSq(a: Vec3, b: Vec3): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}
