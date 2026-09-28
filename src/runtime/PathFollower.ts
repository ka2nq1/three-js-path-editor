import { Quaternion, Vector3, type Object3D } from 'three';
import { defaultCoordinateSystem, type CoordinateSystem } from '../core/coordinates';
import type { Path } from '../core/Path';
import { PathCursor, type LoopMode, type PathCursorEvents, type PathCursorOptions, type SpeedContext } from '../core/PathCursor';
import type { Listener } from '../utils/Emitter';
import { Orienter, type OrientationOptions } from './orientation';

export interface PathFollowerOptions extends PathCursorOptions {
  /** Any Object3D: mesh, group, camera, light... */
  object: Object3D;
  /** Orientation settings, or `false` to only move the object. Default: enabled, +Z forward. */
  orientation?: OrientationOptions | boolean;
  /** Face the current travel direction (flips when moving backwards). Default true. */
  faceTravelDirection?: boolean;
  /** Path space -> world space mapping. Default: Y-up, 2D paths on the XZ plane. */
  coordinates?: CoordinateSystem;
  /**
   * 'world' (default): path coordinates are world coordinates; the follower
   * compensates for the object's parent transform. 'parent': path coordinates
   * are written directly to object.position (cheaper, parent-local).
   */
  space?: 'world' | 'parent';
  /** Offset added to the path position, in world units (e.g. hover height). */
  positionOffset?: [number, number, number];
  onProgress?: Listener<PathCursorEvents['progress']>;
  onWaypoint?: Listener<PathCursorEvents['waypoint']>;
  onLoop?: Listener<PathCursorEvents['loop']>;
  onComplete?: Listener<void>;
}

const _pos = new Vector3();
const _dir = new Vector3();
const _q = new Quaternion();
const _parentQ = new Quaternion();

/**
 * Moves (and optionally rotates) an Object3D along a Path. Call `update(dt)`
 * from your existing render/update loop — the follower has no loop of its own.
 */
export class PathFollower {
  readonly object: Object3D;
  readonly cursor: PathCursor;
  readonly orienter: Orienter;
  coordinates: CoordinateSystem;
  space: 'world' | 'parent';
  faceTravelDirection: boolean;
  positionOffset: Vector3;

  private readonly targetRotation = new Quaternion();
  private hasRotation = false;

  constructor(options: PathFollowerOptions) {
    this.object = options.object;
    this.cursor = new PathCursor(options);
    const orientation = options.orientation;
    this.orienter = new Orienter(typeof orientation === 'object' ? orientation : { enabled: orientation !== false });
    this.coordinates = options.coordinates ?? defaultCoordinateSystem;
    this.space = options.space ?? 'world';
    this.faceTravelDirection = options.faceTravelDirection ?? true;
    this.positionOffset = new Vector3(...(options.positionOffset ?? [0, 0, 0]));
    if (options.onProgress) this.on('progress', options.onProgress);
    if (options.onWaypoint) this.on('waypoint', options.onWaypoint);
    if (options.onLoop) this.on('loop', options.onLoop);
    if (options.onComplete) this.on('complete', options.onComplete);
  }

  // Cursor passthroughs -------------------------------------------------------

  get path(): Path {
    return this.cursor.path;
  }
  get speed(): number {
    return this.cursor.speed;
  }
  set speed(value: number) {
    this.cursor.speed = value;
  }
  get loop(): LoopMode {
    return this.cursor.loop;
  }
  set loop(value: LoopMode) {
    this.cursor.loop = value;
  }
  get progress(): number {
    return this.cursor.progress;
  }
  get distance(): number {
    return this.cursor.distance;
  }
  get direction(): 1 | -1 {
    return this.cursor.direction;
  }
  get isPlaying(): boolean {
    return this.cursor.playing;
  }
  /** Current speed in units/second, including waypoint speed multipliers. */
  get currentSpeed(): number {
    return this.cursor.currentSpeed;
  }
  /** Current roll in degrees (from waypoint roll values). */
  get currentRoll(): number {
    return this.rollAt(this.cursor.distance);
  }
  get isComplete(): boolean {
    return this.cursor.complete;
  }
  set speedModifier(fn: ((ctx: SpeedContext) => number) | undefined) {
    this.cursor.speedModifier = fn;
  }

  on<K extends keyof PathCursorEvents>(type: K, listener: Listener<PathCursorEvents[K]>): () => void {
    return this.cursor.events.on(type, listener);
  }

  play(): this {
    this.cursor.play();
    return this;
  }

  pause(): this {
    this.cursor.pause();
    return this;
  }

  /** Back to the start and snap the object there. */
  reset(): this {
    this.cursor.reset();
    this.hasRotation = false;
    this.apply();
    return this;
  }

  /** Jump to normalized progress [0, 1] and apply immediately. */
  setProgress(progress: number): this {
    this.cursor.progress = progress;
    this.apply();
    return this;
  }

  setDistance(distance: number): this {
    this.cursor.distance = distance;
    this.apply();
    return this;
  }

  setPath(path: Path): this {
    this.cursor.setPath(path);
    this.apply();
    return this;
  }

  /** Advance by `dt` seconds and write the pose to the object. */
  update(dt: number): this {
    this.cursor.advance(dt);
    this.apply(dt);
    return this;
  }

  /** Writes the current pose to the object without advancing. */
  apply(dt = 0): this {
    const path = this.cursor.path;
    if (path.waypoints.length === 0) return this;
    const object = this.object;
    const d = this.cursor.distance;

    _pos.fromArray(this.coordinates.toWorld(path.getPointAtDistance(d), path.dimension)).add(this.positionOffset);
    const parent = this.space === 'world' ? object.parent : null;
    if (parent) {
      parent.updateWorldMatrix(true, false);
      object.position.copy(parent.worldToLocal(_pos));
    } else {
      object.position.copy(_pos);
    }

    if (this.orienter.enabled && path.waypoints.length > 1) {
      _dir.fromArray(this.coordinates.directionToWorld(path.getTangentAtDistance(d), path.dimension));
      const backwards = this.faceTravelDirection && this.cursor.direction < 0;
      if (backwards) _dir.negate();
      // Travelling backwards mirrors the turns, so mirror the bank too.
      const roll = (this.rollAt(d) * Math.PI) / 180 * (backwards ? -1 : 1);
      if (this.orienter.compute(_dir, _q, roll)) {
        if (parent) _q.premultiply(parent.getWorldQuaternion(_parentQ).invert());
        const smoothing = this.orienter.smoothing;
        if (smoothing > 0 && this.hasRotation && dt > 0) {
          this.targetRotation.slerp(_q, 1 - Math.exp(-smoothing * dt));
        } else {
          this.targetRotation.copy(_q);
        }
        this.hasRotation = true;
        object.quaternion.copy(this.targetRotation);
      }
    }
    return this;
  }

  private rollAt(distance: number): number {
    const o = this.orienter;
    const path = this.cursor.path;
    if (!o.applyRoll || !path.hasWaypointValues('roll')) return 0;
    return path.getWaypointValueAtDistance('roll', distance, this.cursor.interpolation) * o.rollScale;
  }

  /** Removes event listeners. Does not touch the object. */
  dispose(): void {
    this.cursor.events.clear();
  }
}
