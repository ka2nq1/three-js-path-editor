import { toVec3, type Vec3 } from '../utils/vec3';
import type { Metadata, PathDimension, WaypointData } from './types';

export interface WaypointInit {
  id?: string;
  position: ArrayLike<number>;
  handleIn?: ArrayLike<number> | null;
  handleOut?: ArrayLike<number> | null;
  /** Speed multiplier at this waypoint (1 = follower speed). */
  speed?: number | null;
  /** Bank/roll angle at this waypoint in degrees. Positive = bank right. */
  roll?: number | null;
  metadata?: Metadata;
}

const KNOWN_KEYS = new Set(['id', 'position', 'handleIn', 'handleOut', 'speed', 'roll', 'metadata']);

/**
 * A point on a path, stored in path space. For 2D paths the third component is
 * always 0. Mutate waypoints through `Path` methods so caches stay valid.
 */
export class Waypoint {
  id?: string;
  position: Vec3;
  /** Bezier handle relative to `position`; `null` = auto-generated. */
  handleIn: Vec3 | null;
  /** Bezier handle relative to `position`; `null` = auto-generated. */
  handleOut: Vec3 | null;
  /**
   * Speed multiplier at this waypoint; `undefined` = 1. Interpolated along the
   * path by PathFollower (see `interpolation`).
   */
  speed?: number;
  /** Roll (bank) angle in degrees at this waypoint; `undefined` = 0. Positive banks right. */
  roll?: number;
  metadata: Metadata;
  /** Unknown JSON keys, preserved on export. */
  extras: Record<string, unknown>;

  constructor(init: WaypointInit, extras: Record<string, unknown> = {}) {
    this.id = init.id;
    this.position = toVec3(init.position);
    this.handleIn = init.handleIn ? toVec3(init.handleIn) : null;
    this.handleOut = init.handleOut ? toVec3(init.handleOut) : null;
    if (typeof init.speed === 'number' && Number.isFinite(init.speed)) this.speed = init.speed;
    if (typeof init.roll === 'number' && Number.isFinite(init.roll)) this.roll = init.roll;
    this.metadata = init.metadata ? structuredCloneSafe(init.metadata) : {};
    this.extras = structuredCloneSafe(extras);
  }

  clone(): Waypoint {
    return new Waypoint(this, this.extras);
  }

  toJSON(dimension: PathDimension = 3): WaypointData {
    const out: WaypointData = { ...structuredCloneSafe(this.extras), position: this.position.slice(0, dimension) };
    if (this.id !== undefined) out.id = this.id;
    if (this.handleIn) out.handleIn = this.handleIn.slice(0, dimension);
    if (this.handleOut) out.handleOut = this.handleOut.slice(0, dimension);
    if (this.speed !== undefined) out.speed = this.speed;
    if (this.roll !== undefined) out.roll = this.roll;
    if (Object.keys(this.metadata).length > 0) out.metadata = structuredCloneSafe(this.metadata);
    return out;
  }

  static fromJSON(data: WaypointData): Waypoint {
    const extras: Record<string, unknown> = {};
    for (const key of Object.keys(data)) if (!KNOWN_KEYS.has(key)) extras[key] = data[key];
    return new Waypoint(data, extras);
  }
}

/** Deep copy for JSON-like data (falls back to JSON for older runtimes). */
export function structuredCloneSafe<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}
