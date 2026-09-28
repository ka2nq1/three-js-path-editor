import { lerp, scale, sub, type Vec3 } from '../../utils/vec3';
import { locateSegment, type Curve } from './Curve';

export class LinearCurve implements Curve {
  readonly segmentCount: number;

  constructor(private readonly points: readonly Vec3[], readonly closed = false) {
    this.segmentCount = closed ? points.length : points.length - 1;
  }

  private segment(t: number): [Vec3, Vec3, number] {
    const [i, local] = locateSegment(t, this.segmentCount);
    const n = this.points.length;
    return [this.points[i], this.points[(i + 1) % n], local];
  }

  getPoint(t: number): Vec3 {
    const [a, b, local] = this.segment(t);
    return lerp(a, b, local);
  }

  getDerivative(t: number): Vec3 {
    const [a, b] = this.segment(t);
    return scale(sub(b, a), this.segmentCount);
  }
}
