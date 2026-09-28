import { Plane, Vector3, type Object3D, type Raycaster } from 'three';
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
