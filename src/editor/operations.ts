import { locateSegment } from '../core/curves/Curve';
import type { Path } from '../core/Path';
import type { WaypointInit } from '../core/Waypoint';
import { add, distance, lerp, normalize, scale, sub, type Vec3 } from '../utils/vec3';

/**
 * Point-manipulation helpers shared by the editor, panel and shortcuts.
 * Pure functions over Path, no Three.js.
 */

/** Average distance between consecutive waypoints, or `fallback` for < 2 points. */
export function averageSpacing(path: Path, fallback = 10): number {
  const pts = path.waypoints;
  if (pts.length < 2) return fallback;
  let sum = 0;
  for (let i = 1; i < pts.length; i++) sum += distance(pts[i - 1].position, pts[i].position);
  return sum / (pts.length - 1) || fallback;
}

/**
 * Suggests where a new waypoint inserted after `afterIndex` should go:
 * on the curve between two points, or extrapolated past the last point.
 */
export function suggestWaypointPosition(path: Path, afterIndex: number | null, fallbackSpacing = 10): Vec3 {
  const pts = path.waypoints;
  const n = pts.length;
  if (n === 0) return [0, 0, 0];
  const index = afterIndex === null ? n - 1 : Math.min(Math.max(afterIndex, 0), n - 1);
  const isLast = index === n - 1;
  if (!isLast || (path.curve.closed && n >= 3)) {
    // Midpoint of the segment, on the curve itself.
    const segments = path.segmentCount;
    if (segments > 0) return path.getPoint((index + 0.5) / segments);
    return lerp(pts[index].position, pts[(index + 1) % n].position, 0.5);
  }
  if (n === 1) return add(pts[0].position, [fallbackSpacing, 0, 0]);
  const dir = normalize(sub(pts[n - 1].position, pts[n - 2].position));
  const spacing = averageSpacing(path, fallbackSpacing);
  return add(pts[n - 1].position, scale(dir[0] || dir[1] || dir[2] ? dir : [1, 0, 0], spacing));
}

/** Inserts a waypoint after `afterIndex` (null = append). Returns the new index. */
export function insertWaypointAfter(path: Path, afterIndex: number | null, position?: ArrayLike<number>): number {
  const index = afterIndex === null ? path.waypoints.length : Math.min(afterIndex + 1, path.waypoints.length);
  path.addWaypoint(position ?? suggestWaypointPosition(path, afterIndex), index);
  return index;
}

/** Moves a waypoint one step earlier (-1) or later (+1). Returns its new index. */
export function shiftWaypoint(path: Path, index: number, delta: -1 | 1): number {
  const target = index + delta;
  if (target < 0 || target >= path.waypoints.length) return index;
  path.reorderWaypoint(index, target);
  return target;
}

/**
 * Inserts a waypoint on the curve at parameter t (e.g. where the user clicked
 * the line). Bezier paths are split exactly (de Casteljau) so the shape is
 * unchanged; speed/roll of the new point are interpolated from its neighbours.
 * Returns the new waypoint index.
 */
export function insertWaypointAtT(path: Path, t: number): number {
  const pts = path.waypoints;
  const n = pts.length;
  const segments = path.segmentCount;
  if (segments === 0) return insertWaypointAfter(path, null);
  const [seg, s] = locateSegment(t, segments);
  const a = pts[seg];
  const b = pts[(seg + 1) % n];
  const position = path.getPoint(t);
  const init: WaypointInit = { position };
  for (const key of ['speed', 'roll'] as const) {
    if (a[key] !== undefined || b[key] !== undefined) {
      const fallback = key === 'speed' ? 1 : 0;
      init[key] = (a[key] ?? fallback) + ((b[key] ?? fallback) - (a[key] ?? fallback)) * s;
    }
  }
  if (path.curve.type === 'bezier') {
    // Freeze the neighbours' current handles: their auto handles would
    // otherwise change once the new point becomes their neighbour.
    const ha = path.getBezierHandles(seg)!;
    const hb = path.getBezierHandles((seg + 1) % n)!;
    const c0 = a.position;
    const c1 = add(c0, ha.handleOut);
    const c3 = b.position;
    const c2 = add(c3, hb.handleIn);
    const q0 = lerp(c0, c1, s);
    const q1 = lerp(c1, c2, s);
    const q2 = lerp(c2, c3, s);
    const r0 = lerp(q0, q1, s);
    const r1 = lerp(q1, q2, s);
    a.handleIn = ha.handleIn;
    a.handleOut = sub(q0, c0);
    b.handleIn = sub(q2, c3);
    b.handleOut = hb.handleOut;
    init.handleIn = sub(r0, position);
    init.handleOut = sub(r1, position);
  }
  const index = seg + 1;
  path.addWaypoint(init, index);
  return index;
}
