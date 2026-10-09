import type { Vec3 } from '../utils/vec3';

export type { Vec3 };

/** Arbitrary user data. Preserved verbatim on import/export. */
export type Metadata = Record<string, unknown>;

export type PathDimension = 2 | 3;

/**
 * What a `Path` stands for: a route to travel ('path', the default), or a
 * single named place — a spawn point, a prop, a light, anything an object just
 * stands on ('marker'). A marker holds exactly one waypoint and no curve, so
 * the editor hides curve settings for it and refuses further points.
 */
export type PathKind = 'path' | 'marker';

export type CurveType = 'linear' | 'catmull-rom' | 'bezier';

/**
 * Catmull-Rom knot spacing, same meaning as THREE.CatmullRomCurve3's curveType:
 * 'uniform' ('catmullrom' in three, uses `tension`), 'centripetal' (avoids
 * cusps and overshoot on uneven spacing), 'chordal'.
 */
export type CatmullRomParametrization = 'uniform' | 'centripetal' | 'chordal';

export interface CurveOptions {
  type: CurveType;
  /** Connect the last waypoint back to the first. Default `false`. */
  closed: boolean;
  /**
   * Catmull-Rom tension (0.5 = standard Catmull-Rom, 0 = straight segments).
   * Also used to auto-generate Bezier handles that are not set explicitly.
   */
  tension: number;
  /**
   * Catmull-Rom only. Default 'uniform'. Match the parametrization your runtime
   * uses (e.g. THREE.CatmullRomCurve3 'centripetal') so the editor shows the
   * exact curve the game follows. `tension` only applies to 'uniform'.
   */
  parametrization?: CatmullRomParametrization;
  /**
   * Interpolate height (the path-space up component, y) linearly between
   * waypoints while x/z follow the curve. 3D paths with a curved type only.
   * Use it for routes authored on a surface: a spline overshoots in height
   * where a flat stretch meets a climb and dips below the floor the waypoints
   * sit on. Default `false`.
   */
  linearHeight?: boolean;
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
  /** Facing in degrees around the up axis for an object standing on this point. */
  yaw?: number;
  /** Authored time at this waypoint, in the host's units. See `Path.distanceAtTime`. */
  time?: number;
  metadata?: Metadata;
  [key: string]: unknown;
}

/** JSON representation of a path. Unknown keys are preserved. */
export interface PathData {
  id: string;
  name?: string;
  /** 'marker' for a single-point place; omitted for ordinary paths. */
  kind?: PathKind;
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

/** Plain per-waypoint numbers the editor edits but nothing blends. */
export type WaypointFieldKey = 'yaw' | 'time';
