import { lerp, set, type Vec3 } from '../../utils/vec3';
import { locateSegmentInto, type Curve, type SegmentLocation } from './Curve';

export class LinearCurve implements Curve {
  readonly segmentCount: number;
  private readonly location: SegmentLocation = { index: 0, t: 0 };

  constructor(private readonly points: readonly Vec3[], readonly closed = false) {
    this.segmentCount = closed ? points.length : points.length - 1;
  }

  getPoint(t: number, out?: Vec3): Vec3 {
    const { index, t: local } = locateSegmentInto(t, this.segmentCount, this.location);
    return lerp(this.points[index], this.points[(index + 1) % this.points.length], local, out);
  }

  getDerivative(t: number, out?: Vec3): Vec3 {
    const { index } = locateSegmentInto(t, this.segmentCount, this.location);
    const a = this.points[index];
    const b = this.points[(index + 1) % this.points.length];
    const f = this.segmentCount;
    return set(out ?? [0, 0, 0], (b[0] - a[0]) * f, (b[1] - a[1]) * f, (b[2] - a[2]) * f);
  }
}
