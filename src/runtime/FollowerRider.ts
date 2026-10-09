import { Quaternion, type Object3D } from 'three';
import { Orienter, type OrientationOptions } from './orientation';

export interface RiderOptions {
  /** Any Object3D: mesh, group, camera, light... */
  object: Object3D;
  /**
   * Distance behind the leader along the path, in path units (negative =
   * ahead). Default 0.
   */
  offset?: number;
  /**
   * Sideways and upwards offset from the path, in world units, in the frame of
   * the rider's own position: `[right, up]`. Default `[0, 0]`.
   */
  lateral?: [number, number];
  /**
   * Orientation settings for this rider, or `false` to only move it. Default:
   * the leader's settings.
   */
  orientation?: OrientationOptions | boolean;
}

/**
 * An object carried along a `PathFollower`'s path at a fixed offset: a convoy
 * car, a flock member, a camera trailing a vehicle. Riders share the leader's
 * cursor — no second integration of speed, loops or events — and are posed
 * from the same path, each at its own distance.
 */
export class FollowerRider {
  readonly object: Object3D;
  readonly orienter: Orienter;
  offset: number;
  lateral: [number, number];
  /** @internal Current rotation, in the object's own frame. */
  readonly rotation = new Quaternion();
  /** @internal Whether `rotation` holds a pose smoothing can ease from. */
  hasRotation = false;

  constructor(options: RiderOptions, fallback?: Orienter) {
    this.object = options.object;
    this.offset = options.offset ?? 0;
    this.lateral = options.lateral ?? [0, 0];
    const orientation = options.orientation;
    this.orienter = orientation === undefined && fallback
      ? fallback
      : new Orienter(typeof orientation === 'object' ? orientation : { enabled: orientation !== false });
  }

  /**
   * Seeds the rotation smoothing eases from, in the object's own frame.
   * Without it the first frame snaps onto the path's heading.
   */
  seedRotation(rotation: Quaternion): this {
    this.rotation.copy(rotation);
    this.hasRotation = true;
    return this;
  }
}
