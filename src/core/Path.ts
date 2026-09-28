import { Emitter } from '../utils/Emitter';
import { createId } from '../utils/id';
import { clamp } from '../utils/math';
import { EPSILON, clone, distance, normalize, sub, toVec3, type Vec3 } from '../utils/vec3';
import { ArcLengthTable } from './ArcLengthTable';
import { createCurve, resolveBezierHandles, type BezierHandles, type Curve } from './curves';
import type {
  CurveOptions,
  CurveType,
  Metadata,
  PathData,
  PathDimension,
  WaypointData,
  WaypointInterpolation,
  WaypointValueKey,
} from './types';
import { Waypoint, structuredCloneSafe, type WaypointInit } from './Waypoint';

export type WaypointInput = ArrayLike<number> | WaypointInit | Waypoint;

export interface PathOptions {
  id?: string;
  name?: string;
  /** Default 3. */
  dimension?: PathDimension;
  /** Curve type or full options. Default 'catmull-rom'. */
  curve?: CurveType | Partial<CurveOptions>;
  points?: WaypointInput[];
  metadata?: Metadata;
}

export interface PathEvents {
  /** Fired after any mutation (points, curve settings, metadata via `markChanged`). */
  change: Path;
}

export const DEFAULT_CURVE: CurveOptions = { type: 'catmull-rom', closed: false, tension: 0.5 };

const KNOWN_KEYS = new Set(['id', 'name', 'dimension', 'curve', 'points', 'metadata']);

export function normalizeCurveOptions(curve?: CurveType | Partial<CurveOptions>): CurveOptions {
  if (typeof curve === 'string') return { ...DEFAULT_CURVE, type: curve };
  return { ...DEFAULT_CURVE, ...curve };
}

interface Cache {
  version: number;
  curve: Curve;
  table: ArcLengthTable;
  waypointDistances?: number[];
}

/**
 * A 2D or 3D path made of waypoints and a curve type. Pure data + math:
 * no Three.js dependency. All positions are in path space.
 */
export class Path {
  readonly events = new Emitter<PathEvents>();
  id: string;
  name?: string;
  readonly dimension: PathDimension;
  readonly curve: CurveOptions;
  readonly waypoints: Waypoint[] = [];
  metadata: Metadata;
  /** Unknown JSON keys, preserved on export. */
  extras: Record<string, unknown> = {};

  private _version = 0;
  private cache: Cache | null = null;

  constructor(options: PathOptions = {}) {
    this.id = options.id ?? createId('path');
    this.name = options.name;
    this.dimension = options.dimension === 2 ? 2 : 3;
    this.curve = normalizeCurveOptions(options.curve);
    this.metadata = options.metadata ? structuredCloneSafe(options.metadata) : {};
    for (const p of options.points ?? []) this.waypoints.push(this.toWaypoint(p));
  }

  /** Increments on every change. Useful for cheap dirty checks. */
  get version(): number {
    return this._version;
  }

  get length(): number {
    return this.getCache().table.totalLength;
  }

  get segmentCount(): number {
    return this.getCache().curve.segmentCount;
  }

  // ---------------------------------------------------------------- mutation

  /** Adds a waypoint at `index` (default: end). Returns the new waypoint. */
  addWaypoint(point: WaypointInput, index = this.waypoints.length): Waypoint {
    const wp = this.toWaypoint(point);
    this.waypoints.splice(clamp(Math.round(index), 0, this.waypoints.length), 0, wp);
    this.markChanged();
    return wp;
  }

  removeWaypoint(index: number): Waypoint | undefined {
    if (index < 0 || index >= this.waypoints.length) return undefined;
    const [removed] = this.waypoints.splice(index, 1);
    this.markChanged();
    return removed;
  }

  moveWaypoint(index: number, position: ArrayLike<number>): void {
    const wp = this.waypoints[index];
    if (!wp) return;
    wp.position = this.sanitize(toVec3(position));
    this.markChanged();
  }

  /** Sets explicit Bezier handles (relative to the waypoint). `null` restores auto. */
  setWaypointHandles(
    index: number,
    handles: { handleIn?: ArrayLike<number> | null; handleOut?: ArrayLike<number> | null },
  ): void {
    const wp = this.waypoints[index];
    if (!wp) return;
    if (handles.handleIn !== undefined) wp.handleIn = handles.handleIn ? this.sanitize(toVec3(handles.handleIn)) : null;
    if (handles.handleOut !== undefined) wp.handleOut = handles.handleOut ? this.sanitize(toVec3(handles.handleOut)) : null;
    this.markChanged();
  }

  /**
   * Sets per-waypoint speed multiplier / roll (degrees). `null` restores the
   * default (speed 1, roll 0); `undefined` leaves the value unchanged.
   */
  setWaypointProperties(index: number, props: { speed?: number | null; roll?: number | null }): void {
    const wp = this.waypoints[index];
    if (!wp) return;
    for (const key of ['speed', 'roll'] as const) {
      const value = props[key];
      if (value === undefined) continue;
      if (value === null || !Number.isFinite(value)) delete wp[key];
      else wp[key] = value;
    }
    this.markChanged();
  }

  /** Moves the waypoint at `from` so it ends up at index `to`. */
  reorderWaypoint(from: number, to: number): void {
    const n = this.waypoints.length;
    if (from < 0 || from >= n) return;
    const target = clamp(to, 0, n - 1);
    if (target === from) return;
    const [wp] = this.waypoints.splice(from, 1);
    this.waypoints.splice(target, 0, wp);
    this.markChanged();
  }

  /** Reverses travel direction (also swaps Bezier handles). */
  reverse(): void {
    this.waypoints.reverse();
    for (const wp of this.waypoints) [wp.handleIn, wp.handleOut] = [wp.handleOut, wp.handleIn];
    this.markChanged();
  }

  setCurve(options: CurveType | Partial<CurveOptions>): void {
    Object.assign(this.curve, typeof options === 'string' ? { type: options } : options);
    this.markChanged();
  }

  /** Call after mutating waypoints or metadata directly. */
  markChanged(): void {
    this._version++;
    this.cache = null;
    this.events.emit('change', this);
  }

  // -------------------------------------------------------------- evaluation

  /** Point at raw curve parameter t in [0, 1] (not constant speed). */
  getPoint(t: number): Vec3 {
    return this.getCache().curve.getPoint(t);
  }

  /** Point at normalized arc length u in [0, 1] (constant speed). */
  getPointAt(u: number): Vec3 {
    return this.getPointAtDistance(clamp(u, 0, 1) * this.length);
  }

  /** Unit tangent at normalized arc length u in [0, 1]. */
  getTangentAt(u: number): Vec3 {
    return this.getTangentAtDistance(clamp(u, 0, 1) * this.length);
  }

  getPointAtDistance(d: number): Vec3 {
    const { curve, table } = this.getCache();
    return curve.getPoint(table.tAtDistance(d));
  }

  getTangentAtDistance(d: number): Vec3 {
    const { curve, table } = this.getCache();
    return this.tangentAtT(curve, table.tAtDistance(d));
  }

  /** Unit tangent at raw curve parameter t. */
  getTangent(t: number): Vec3 {
    return this.tangentAtT(this.getCache().curve, t);
  }

  /** Samples the curve by parameter; hits every waypoint exactly. Good for rendering. */
  sample(divisionsPerSegment = 32): Vec3[] {
    const { curve } = this.getCache();
    if (curve.segmentCount === 0) return this.waypoints.length ? [curve.getPoint(0)] : [];
    const per = this.curve.type === 'linear' ? 1 : Math.max(1, Math.floor(divisionsPerSegment));
    const total = curve.segmentCount * per;
    const out: Vec3[] = [];
    for (let i = 0; i <= total; i++) out.push(curve.getPoint(i / total));
    return out;
  }

  /** `count` points evenly spaced by arc length (count >= 2). */
  getSpacedPoints(count: number): Vec3[] {
    const n = Math.max(2, Math.floor(count));
    const out: Vec3[] = [];
    for (let i = 0; i < n; i++) out.push(this.getPointAt(i / (n - 1)));
    return out;
  }

  /** Distance along the path at which each waypoint is located. */
  getWaypointDistances(): number[] {
    const cache = this.getCache();
    if (!cache.waypointDistances) {
      const segs = cache.curve.segmentCount;
      cache.waypointDistances = this.waypoints.map((_, i) =>
        segs === 0 ? 0 : cache.table.distanceAtT(Math.min(i / segs, 1)),
      );
    }
    return cache.waypointDistances;
  }

  /** True if any waypoint defines `key` (speed or roll). */
  hasWaypointValues(key: WaypointValueKey): boolean {
    return this.waypoints.some((w) => w[key] !== undefined);
  }

  /**
   * Per-waypoint value (speed multiplier or roll in degrees) at a distance
   * along the path, blended between the surrounding waypoints. Waypoints
   * without the value use the default (speed 1, roll 0).
   */
  getWaypointValueAtDistance(key: WaypointValueKey, d: number, interpolation: WaypointInterpolation = 'smooth'): number {
    const fallback = key === 'speed' ? 1 : 0;
    const pts = this.waypoints;
    const n = pts.length;
    const value = (i: number) => pts[i][key] ?? fallback;
    if (n === 0) return fallback;
    if (n === 1) return value(0);
    const ds = this.getWaypointDistances();
    const length = this.length;
    const x = clamp(d, 0, length);
    let i = 0;
    while (i < n - 1 && ds[i + 1] <= x) i++;
    const last = i === n - 1;
    if (last && !this.curve.closed) return value(n - 1);
    const a = ds[i];
    const b = last ? length : ds[i + 1];
    const v0 = value(i);
    const v1 = value(last ? 0 : i + 1);
    if (interpolation === 'step' || b <= a) return v0;
    let f = (x - a) / (b - a);
    if (interpolation === 'smooth') f = f * f * (3 - 2 * f);
    return v0 + (v1 - v0) * f;
  }

  /**
   * Closest point on the curve to `point` (path space). Returns the curve
   * parameter t, normalized arc length u, the point and its distance.
   */
  getClosestPoint(point: ArrayLike<number>, samplesPerSegment = 64): { t: number; u: number; point: Vec3; distance: number } {
    const { curve, table } = this.getCache();
    const target = this.sanitize(toVec3(point));
    if (curve.segmentCount === 0) {
      const p = curve.getPoint(0);
      return { t: 0, u: 0, point: p, distance: distance(p, target) };
    }
    const total = curve.segmentCount * samplesPerSegment;
    let bestT = 0;
    let best = Infinity;
    for (let k = 0; k <= total; k++) {
      const d = distance(curve.getPoint(k / total), target);
      if (d < best) {
        best = d;
        bestT = k / total;
      }
    }
    // Refine around the best sample (ternary search).
    let lo = Math.max(0, bestT - 1 / total);
    let hi = Math.min(1, bestT + 1 / total);
    for (let iter = 0; iter < 30; iter++) {
      const m1 = lo + (hi - lo) / 3;
      const m2 = hi - (hi - lo) / 3;
      if (distance(curve.getPoint(m1), target) < distance(curve.getPoint(m2), target)) hi = m2;
      else lo = m1;
    }
    const t = (lo + hi) / 2;
    const p = curve.getPoint(t);
    const length = table.totalLength;
    return { t, u: length > 0 ? table.distanceAtT(t) / length : 0, point: p, distance: distance(p, target) };
  }

  /** Effective Bezier handles (explicit or auto) for a waypoint, relative to it. */
  getBezierHandles(index: number): BezierHandles | undefined {
    if (!this.waypoints[index]) return undefined;
    const positions = this.waypoints.map((w) => w.position);
    return resolveBezierHandles(positions, this.waypoints, this.curve.closed, this.curve.tension)[index];
  }

  // ------------------------------------------------------------ serialization

  clone(options: { id?: string } = {}): Path {
    const copy = Path.fromJSON(this.toJSON());
    if (options.id) copy.id = options.id;
    return copy;
  }

  toJSON(): PathData {
    const out: PathData = {
      ...structuredCloneSafe(this.extras),
      id: this.id,
      dimension: this.dimension,
      curve: { ...this.curve },
      points: this.waypoints.map((w) => w.toJSON(this.dimension)),
      metadata: structuredCloneSafe(this.metadata),
    };
    if (this.name !== undefined) out.name = this.name;
    return out;
  }

  static fromJSON(data: PathData): Path {
    const path = new Path({
      id: data.id,
      name: data.name,
      dimension: data.dimension,
      curve: data.curve,
      metadata: data.metadata,
      points: (data.points ?? []).map((p: WaypointData) => Waypoint.fromJSON(p)),
    });
    path.extras = extrasOf(data);
    return path;
  }

  /**
   * Replaces this path's content with `data` in place, keeping the object
   * identity (used by undo/redo so followers keep working). The dimension
   * cannot change.
   */
  setData(data: PathData): void {
    if ((data.dimension === 2 ? 2 : 3) !== this.dimension) {
      throw new Error(`Path.setData: dimension ${data.dimension} does not match ${this.dimension}.`);
    }
    this.id = data.id;
    this.name = data.name;
    Object.assign(this.curve, normalizeCurveOptions(data.curve));
    const points = (data.points ?? []).map((p: WaypointData) => this.toWaypoint(Waypoint.fromJSON(p)));
    this.waypoints.splice(0, this.waypoints.length, ...points);
    this.metadata = data.metadata ? structuredCloneSafe(data.metadata) : {};
    this.extras = extrasOf(data);
    this.markChanged();
  }

  // ---------------------------------------------------------------- internal

  private toWaypoint(input: WaypointInput): Waypoint {
    let wp: Waypoint;
    if (input instanceof Waypoint) wp = input;
    else if (isWaypointInit(input)) wp = new Waypoint(input);
    else wp = new Waypoint({ position: input });
    wp.position = this.sanitize(wp.position);
    if (wp.handleIn) wp.handleIn = this.sanitize(wp.handleIn);
    if (wp.handleOut) wp.handleOut = this.sanitize(wp.handleOut);
    return wp;
  }

  private sanitize(v: Vec3): Vec3 {
    return this.dimension === 2 ? [v[0], v[1], 0] : v;
  }

  private getCache(): Cache {
    if (!this.cache || this.cache.version !== this._version) {
      const curve = createCurve(this.waypoints, this.curve);
      this.cache = { version: this._version, curve, table: new ArcLengthTable(curve) };
    }
    return this.cache;
  }

  private tangentAtT(curve: Curve, t: number): Vec3 {
    let tangent = normalize(curve.getDerivative(t));
    if (tangent[0] === 0 && tangent[1] === 0 && tangent[2] === 0) {
      // Zero derivative (coincident points / cusp): fall back to a finite difference.
      const h = 1e-3;
      const a = curve.getPoint(clamp(t - h, 0, 1));
      const b = curve.getPoint(clamp(t + h, 0, 1));
      tangent = normalize(sub(b, a));
    }
    if (Math.abs(tangent[0]) + Math.abs(tangent[1]) + Math.abs(tangent[2]) < EPSILON) {
      tangent = this.dimension === 2 ? [1, 0, 0] : [0, 0, 1];
    }
    return clone(tangent);
  }
}

function extrasOf(data: PathData): Record<string, unknown> {
  const extras: Record<string, unknown> = {};
  for (const key of Object.keys(data)) if (!KNOWN_KEYS.has(key)) extras[key] = structuredCloneSafe(data[key]);
  return extras;
}

function isWaypointInit(value: WaypointInput): value is WaypointInit {
  return typeof value === 'object' && value !== null && 'position' in value;
}
