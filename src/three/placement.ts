import { Plane, Raycaster, Vector3, type Object3D } from 'three';
import type { Path } from '../core/Path';

export interface PlacementContext {
  /** Ray through the clicked pixel. */
  raycaster: Raycaster;
  /** Path the waypoint will be added to. */
  path: Path;
  /** World position of the selected (or last) waypoint, if any. */
  reference: Vector3 | null;
  /** World-space normal of the 2D path plane (from the coordinate system). */
  planeNormal: Vector3;
  /** World-space origin of 2D paths (includes elevation). */
  planeOrigin: Vector3;
}

/**
 * Decides where a waypoint goes when the user Shift+clicks the scene.
 * Return a world position, or null to cancel.
 */
export type PlacementProvider = (ctx: PlacementContext) => Vector3 | null;

export interface PlanePlacementOptions {
  /** Plane normal for 3D paths. Default [0, 1, 0]. 2D paths always use the coordinate-system plane. */
  normal?: [number, number, number];
  /**
   * Height of the plane along the normal for 3D paths. Default: through the
   * reference waypoint (keeps the current altitude), or 0 when there is none.
   */
  height?: number;
}

const _hit = new Vector3();

/** Places waypoints on a mathematical plane. Default provider. */
export function planePlacement(options: PlanePlacementOptions = {}): PlacementProvider {
  return ({ raycaster, path, reference, planeNormal, planeOrigin }) => {
    const plane = new Plane();
    if (path.dimension === 2) {
      plane.setFromNormalAndCoplanarPoint(planeNormal, planeOrigin);
    } else {
      const normal = new Vector3(...(options.normal ?? [0, 1, 0])).normalize();
      if (options.height !== undefined) plane.set(normal, -options.height);
      else plane.setFromNormalAndCoplanarPoint(normal, reference ?? new Vector3());
    }
    return raycaster.ray.intersectPlane(plane, _hit) ? _hit.clone() : null;
  };
}

export interface ObjectPlacementOptions {
  recursive?: boolean;
  /** Offset along the hit face normal (e.g. 2 = two units above the surface). */
  surfaceOffset?: number;
  /** Used when nothing is hit. Default: plane placement. */
  fallback?: PlacementProvider | null;
}

/**
 * Places waypoints on the first intersected object (terrain, map, floor...).
 * Pass the objects of your project that should accept waypoint clicks.
 */
export function objectPlacement(
  objects: Object3D[] | (() => Object3D[]),
  options: ObjectPlacementOptions = {},
): PlacementProvider {
  const fallback = options.fallback === undefined ? planePlacement() : options.fallback;
  return (ctx) => {
    const targets = typeof objects === 'function' ? objects() : objects;
    const hits = ctx.raycaster.intersectObjects(targets, options.recursive ?? true);
    const hit = hits.find((h) => !h.object.userData.pathEditor);
    if (hit) {
      const point = hit.point.clone();
      if (options.surfaceOffset && hit.face) {
        const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
        point.addScaledVector(normal, options.surfaceOffset);
      }
      return point;
    }
    return fallback ? fallback(ctx) : null;
  };
}

export interface ConstraintContext {
  path: Path;
  /** Index of the waypoint being placed or moved. */
  waypointIndex: number;
  /** Proposed world position. Return a new vector (or mutate and return this one). */
  position: Vector3;
}

/**
 * Adjusts a waypoint's world position whenever the editor places or moves it
 * (gizmo drag, Shift+click, insert, typed coordinates). Return the position to
 * use, or null/undefined to keep the proposal unchanged.
 */
export type WaypointConstraint = (ctx: ConstraintContext) => Vector3 | null | undefined | void;

export interface SurfaceConstraintOptions {
  /** Distance kept above the surface, along `up`. Default 0. */
  offset?: number;
  /** World up direction. Default [0, 1, 0]. */
  up?: [number, number, number];
  /** How far above the proposal the downward ray starts. Default 10000. */
  castHeight?: number;
  recursive?: boolean;
  /** Only constrain these paths. Default: every path. */
  filter?: (path: Path) => boolean;
}

/**
 * Keeps waypoints on top of the given objects (terrain, floors, roads): the
 * position is dropped straight down (along -up) onto the highest surface
 * under it. Horizontal movement stays free. Positions with nothing below are
 * left unchanged.
 */
export function surfaceConstraint(
  objects: Object3D[] | (() => Object3D[]),
  options: SurfaceConstraintOptions = {},
): WaypointConstraint {
  const up = new Vector3(...(options.up ?? [0, 1, 0])).normalize();
  const down = up.clone().negate();
  const castHeight = options.castHeight ?? 10000;
  const raycaster = new Raycaster();
  return ({ path, position }) => {
    if (options.filter && !options.filter(path)) return null;
    const targets = typeof objects === 'function' ? objects() : objects;
    raycaster.set(position.clone().addScaledVector(up, castHeight), down);
    raycaster.far = castHeight * 2;
    const hit = raycaster.intersectObjects(targets, options.recursive ?? true).find((h) => !h.object.userData.pathEditor);
    if (!hit) return null;
    return hit.point.clone().addScaledVector(up, options.offset ?? 0);
  };
}
