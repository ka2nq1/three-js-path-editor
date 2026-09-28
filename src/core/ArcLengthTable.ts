import { distance, type Vec3 } from '../utils/vec3';
import type { Curve } from './curves/Curve';

/**
 * Samples a curve to map between distance along the curve and curve parameter t.
 * Enables constant-speed movement regardless of waypoint spacing.
 */
export class ArcLengthTable {
  readonly totalLength: number;
  private readonly lengths: Float64Array;
  private readonly divisions: number;

  constructor(curve: Curve, samplesPerSegment = 64) {
    this.divisions = Math.min(Math.max(1, curve.segmentCount) * samplesPerSegment, 50_000);
    this.lengths = new Float64Array(this.divisions + 1);
    let prev: Vec3 = curve.getPoint(0);
    let sum = 0;
    for (let i = 1; i <= this.divisions; i++) {
      const p = curve.getPoint(i / this.divisions);
      sum += distance(prev, p);
      this.lengths[i] = sum;
      prev = p;
    }
    this.totalLength = sum;
  }

  /** Curve parameter t for a distance along the curve (clamped). */
  tAtDistance(d: number): number {
    const { lengths, divisions, totalLength } = this;
    if (totalLength <= 0 || d <= 0) return 0;
    if (d >= totalLength) return 1;
    let lo = 0;
    let hi = divisions;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (lengths[mid] < d) lo = mid;
      else hi = mid;
    }
    const span = lengths[hi] - lengths[lo];
    const f = span > 0 ? (d - lengths[lo]) / span : 0;
    return (lo + f) / divisions;
  }

  /** Distance along the curve for curve parameter t. */
  distanceAtT(t: number): number {
    const x = Math.min(Math.max(t, 0), 1) * this.divisions;
    const i = Math.min(Math.floor(x), this.divisions - 1);
    const f = x - i;
    return this.lengths[i] + (this.lengths[i + 1] - this.lengths[i]) * f;
  }
}
