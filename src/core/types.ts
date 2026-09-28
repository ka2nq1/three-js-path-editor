import type { Vec3 } from '../utils/vec3';

export type { Vec3 };

/** Arbitrary user data. Preserved verbatim on import/export. */
export type Metadata = Record<string, unknown>;

export type PathDimension = 2 | 3;

export type CurveType = 'linear' | 'catmull-rom' | 'bezier';

export interface CurveOptions {
  type: CurveType;
  /** Connect the last waypoint back to the first. Default `false`. */
  closed: boolean;
  /**
   * Catmull-Rom tension (0.5 = standard Catmull-Rom, 0 = straight segments).
   * Also used to auto-generate Bezier handles that are not set explicitly.
   */
  tension: number;
}

/** JSON representation of a waypoint. Unknown keys are preserved. */
export interface WaypointData {
  id?: string;
  /** `[x, y]` for 2D paths, `[x, y, z]` for 3D paths. */
  position: number[];
  /** Bezier handle, relative to `position`. */
  handleIn?: number[];
  /** Bezier handle, relative to `position`. */
  handleOut?: number[];
  /** Speed multiplier at this waypoint (default 1). */
  speed?: number;
  /** Roll/bank angle in degrees at this waypoint (default 0). Positive = bank right. */
  roll?: number;
  metadata?: Metadata;
  [key: string]: unknown;
}

/** JSON representation of a path. Unknown keys are preserved. */
export interface PathData {
  id: string;
  name?: string;
  dimension: PathDimension;
  curve: Partial<CurveOptions> & { type: CurveType };
  points: WaypointData[];
  metadata?: Metadata;
  [key: string]: unknown;
}

/** Versioned JSON file containing one or more paths. Unknown keys are preserved. */
export interface PathFileData {
  version: number;
  paths: PathData[];
  [key: string]: unknown;
}

/**
 * How per-waypoint values (speed, roll) are blended between waypoints:
 * 'smooth' (ease in/out, default), 'linear', or 'step' (value holds until the next waypoint).
 */
export type WaypointInterpolation = 'smooth' | 'linear' | 'step';

export type WaypointValueKey = 'speed' | 'roll';
