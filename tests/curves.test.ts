import { CatmullRomCurve3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { ArcLengthTable, BezierCurve, CatmullRomCurve, LinearCurve, Path, resolveBezierHandles, vecMath } from '../src/core';
import { expectVecClose, square } from './helpers';

describe('LinearCurve', () => {
  it('interpolates straight segments and passes through every point', () => {
    const curve = new LinearCurve(square);
    expect(curve.segmentCount).toBe(3);
    expectVecClose(curve.getPoint(0), square[0]);
    expectVecClose(curve.getPoint(1 / 3), square[1]);
    expectVecClose(curve.getPoint(1 / 6), [5, 0, 0]);
    expectVecClose(curve.getPoint(1), square[3]);
  });

  it('closes back to the first point', () => {
    const curve = new LinearCurve(square, true);
    expect(curve.segmentCount).toBe(4);
    expectVecClose(curve.getPoint(1), square[0]);
    expectVecClose(curve.getPoint(0.875), [0, 0, 5]);
  });
});

describe('CatmullRomCurve', () => {
  it('passes through every waypoint', () => {
    const curve = new CatmullRomCurve(square);
    square.forEach((p, i) => expectVecClose(curve.getPoint(i / curve.segmentCount), p));
  });

  it('matches THREE.CatmullRomCurve3 (catmullrom, tension 0.5)', () => {
    const pts = [
      [0, 20, 0],
      [30, 30, -50],
      [80, 50, -100],
      [120, 40, -80],
    ] as [number, number, number][];
    for (const closed of [false, true]) {
      const ours = new CatmullRomCurve(pts, closed, 0.5);
      const theirs = new CatmullRomCurve3(pts.map((p) => new Vector3(...p)), closed, 'catmullrom', 0.5);
      for (let t = 0; t <= 1; t += 0.05) expectVecClose(ours.getPoint(t), theirs.getPoint(t).toArray(), 4);
    }
  });

  it('has an analytic derivative consistent with finite differences', () => {
    const curve = new CatmullRomCurve(square);
    const t = 0.4;
    const h = 1e-5;
    const numeric = vecMath.scale(vecMath.sub(curve.getPoint(t + h), curve.getPoint(t - h)), 1 / (2 * h));
    expectVecClose(curve.getDerivative(t), numeric, 3);
  });
});

describe('BezierCurve', () => {
  it('with auto handles equals the Catmull-Rom curve', () => {
    const handles = resolveBezierHandles(square, square.map(() => ({ handleIn: null, handleOut: null })), false, 0.5);
    const bezier = new BezierCurve(square, handles);
    const cr = new CatmullRomCurve(square);
    for (let t = 0; t <= 1; t += 0.05) expectVecClose(bezier.getPoint(t), cr.getPoint(t), 6);
  });

  it('respects explicit handles', () => {
    const path = new Path({
      curve: 'bezier',
      points: [
        { position: [0, 0, 0], handleOut: [0, 10, 0] },
        { position: [10, 0, 0], handleIn: [0, 10, 0] },
      ],
    });
    // Symmetric handles pointing up: midpoint is lifted by 0.75 * 10.
    expectVecClose(path.getPoint(0.5), [5, 7.5, 0]);
    expectVecClose(path.getPoint(0), [0, 0, 0]);
    expectVecClose(path.getPoint(1), [10, 0, 0]);
    expect(path.getBezierHandles(0)?.handleOut).toEqual([0, 10, 0]);
  });
});

describe('Arc length', () => {
  it('measures a straight line exactly', () => {
    const table = new ArcLengthTable(new LinearCurve([[0, 0, 0], [3, 4, 0]]));
    expect(table.totalLength).toBeCloseTo(5, 6);
    expect(table.tAtDistance(2.5)).toBeCloseTo(0.5, 6);
    expect(table.distanceAtT(0.5)).toBeCloseTo(2.5, 6);
  });

  it('gives constant-speed sampling with uneven waypoint spacing', () => {
    const path = new Path({ curve: 'linear', points: [[0, 0, 0], [1, 0, 0], [10, 0, 0]] });
    expectVecClose(path.getPointAt(0.5), [5, 0, 0]);
    const spaced = path.getSpacedPoints(11);
    spaced.forEach((p, i) => expect(p[0]).toBeCloseTo(i, 4));
  });

  it('approximates the length of a circle-like closed spline', () => {
    const r = 10;
    const pts = Array.from({ length: 16 }, (_, i) => {
      const a = (i / 16) * Math.PI * 2;
      return [Math.cos(a) * r, 0, Math.sin(a) * r] as [number, number, number];
    });
    const path = new Path({ points: pts, curve: { type: 'catmull-rom', closed: true } });
    expect(path.length).toBeCloseTo(2 * Math.PI * r, 0);
  });

  it('samples every waypoint exactly for rendering', () => {
    const path = new Path({ points: square });
    const samples = path.sample(8);
    expect(samples).toHaveLength(3 * 8 + 1);
    expectVecClose(samples[8], square[1]);
    expect(new Path({ curve: 'linear', points: square }).sample(8)).toHaveLength(4);
  });
});
