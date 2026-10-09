import { set, type Vec3 } from '../utils/vec3';
import type { PathDimension } from './types';

/**
 * Maps between path space (what is stored in JSON) and world space (the
 * coordinates of the Three.js scene / the followed object's reference frame).
 * Implement this interface for custom conventions.
 */
export interface CoordinateSystem {
  /**
   * Every converter takes an optional output vector, writes into it and
   * returns it, so per-frame conversion allocates nothing. Without one it
   * returns a new vector.
   */
  toWorld(point: Vec3, dimension: PathDimension, out?: Vec3): Vec3;
  toPath(point: Vec3, dimension: PathDimension, out?: Vec3): Vec3;
  /** Converts a direction (no translation). */
  directionToWorld(direction: Vec3, dimension: PathDimension, out?: Vec3): Vec3;
  /** World-space normal of the plane 2D paths live on. */
  readonly planeNormal: Vec3;
}

/** Plane used for 2D paths: 'xz' = ground plane in Y-up scenes, 'xy' = side view / screen plane. */
export type Plane2D = 'xz' | 'xy';

export interface CoordinateSystemOptions {
  /** Plane that 2D paths are placed on. Default 'xz' (Y-up ground). */
  plane2D?: Plane2D;
  /** Constant world offset along the plane normal for 2D paths. Default 0. */
  elevation2D?: number;
  /** World position of the path-space origin. Default [0, 0, 0]. */
  origin?: Vec3;
  /** Uniform scale from path units to world units. Default 1. */
  scale?: number;
}

/**
 * Default coordinate system. 3D: world = origin + p * scale.
 * 2D 'xz': path [x, y] -> world (x, elevation, y). 2D 'xy': path [x, y] -> world (x, y, elevation).
 */
export function createCoordinateSystem(options: CoordinateSystemOptions = {}): CoordinateSystem {
  const plane = options.plane2D ?? 'xz';
  const elevation = options.elevation2D ?? 0;
  const origin = options.origin ?? [0, 0, 0];
  const s = options.scale ?? 1;

  const dirToWorld = (d: Vec3, dim: PathDimension, out?: Vec3): Vec3 => {
    const target = out ?? ([0, 0, 0] as Vec3);
    if (dim === 3) return set(target, d[0] * s, d[1] * s, d[2] * s);
    return plane === 'xz' ? set(target, d[0] * s, 0, d[1] * s) : set(target, d[0] * s, d[1] * s, 0);
  };

  return {
    planeNormal: plane === 'xz' ? [0, 1, 0] : [0, 0, 1],
    directionToWorld: dirToWorld,
    toWorld(p, dim, out) {
      const target = dirToWorld(p, dim, out);
      set(target, origin[0] + target[0], origin[1] + target[1], origin[2] + target[2]);
      if (dim === 2) target[plane === 'xz' ? 1 : 2] += elevation;
      return target;
    },
    toPath(w, dim, out) {
      const x = (w[0] - origin[0]) / s;
      const y = (w[1] - origin[1]) / s;
      const z = (w[2] - origin[2]) / s;
      const target = out ?? ([0, 0, 0] as Vec3);
      if (dim === 3) return set(target, x, y, z);
      return plane === 'xz' ? set(target, x, z, 0) : set(target, x, y, 0);
    },
  };
}

export const defaultCoordinateSystem: CoordinateSystem = createCoordinateSystem();
