import { describe, expect, it } from 'vitest';
import { Path } from '../src';

// A flat leg running into a climb: the classic sag of a spline authored on a
// floor, dipping below it before the stairs.
const points = [
  [0, 0, 0],
  [10, 0, 0],
  [14, 6, 0],
];

const lowestHeight = (path: Path, upTo: number): number => {
  let min = Infinity;
  for (let i = 0; i <= 200; i++) min = Math.min(min, path.getPoint((i / 200) * upTo)[1]);
  return min;
};

const curve = (extra: Record<string, unknown> = {}) => ({
  type: 'catmull-rom' as const,
  parametrization: 'centripetal' as const,
  ...extra,
});

describe('linearHeight', () => {
  it('a spline sags below the flat leg without it', () => {
    expect(lowestHeight(new Path({ curve: curve(), points }), 0.5)).toBeLessThan(-0.2);
  });

  it('keeps height inside the span of the two waypoints of a segment', () => {
    const path = new Path({ curve: curve({ linearHeight: true }), points });
    expect(lowestHeight(path, 0.5)).toBeCloseTo(0, 9);
    expect(path.getPoint(0.75)[1]).toBeCloseTo(3);
    for (let i = 0; i <= 100; i++) {
      const y = path.getPoint(i / 100)[1];
      expect(y).toBeGreaterThanOrEqual(-1e-9);
      expect(y).toBeLessThanOrEqual(6 + 1e-9);
    }
  });

  it('leaves the other axes on the curve', () => {
    const spline = new Path({ curve: curve(), points });
    const flattened = new Path({ curve: curve({ linearHeight: true }), points });
    expect(flattened.getPoint(0.3)[0]).toBeCloseTo(spline.getPoint(0.3)[0]);
    expect(flattened.getPoint(0.3)[1]).not.toBeCloseTo(spline.getPoint(0.3)[1]);
  });

  it('keeps the tangent continuous with the height it interpolates', () => {
    const path = new Path({ curve: curve({ linearHeight: true }), points });
    expect(path.getTangentAt(0.2)[1]).toBeCloseTo(0, 6);
    expect(path.getTangentAt(0.95)[1]).toBeGreaterThan(0);
  });

  it('still hits every waypoint', () => {
    const path = new Path({ curve: curve({ linearHeight: true }), points });
    for (let i = 0; i < points.length; i++) {
      expect(path.getPoint(i / (points.length - 1))).toEqual(points[i]);
    }
  });

  it('does nothing on 2D paths or linear curves, where there is no height to fix', () => {
    const flat2d = new Path({ dimension: 2, curve: curve({ linearHeight: true }), points: [[0, 0], [10, 0], [14, 6]] });
    const spline2d = new Path({ dimension: 2, curve: curve(), points: [[0, 0], [10, 0], [14, 6]] });
    expect(flat2d.getPoint(0.3)).toEqual(spline2d.getPoint(0.3));
    const straight = new Path({ curve: { type: 'linear', linearHeight: true }, points });
    expect(straight.getPoint(0.25)[1]).toBeCloseTo(0);
  });

  it('round-trips through JSON', () => {
    const path = new Path({ curve: curve({ linearHeight: true }), points });
    const copy = Path.fromJSON(path.toJSON());
    expect(copy.curve.linearHeight).toBe(true);
    expect(copy.getPoint(0.3)).toEqual(path.getPoint(0.3));
  });
});
