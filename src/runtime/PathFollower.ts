import { Quaternion, Vector3, type Object3D } from 'three';
import { defaultCoordinateSystem, type CoordinateSystem } from '../core/coordinates';
import type { Path } from '../core/Path';
import {
  PathCursor,
  type LoopMode,
  type PathCursorEvents,
  type PathCursorOptions,
  type SeekOptions,
  type SpeedContext,
  type WaypointTarget,
} from '../core/PathCursor';
import { Emitter, type Listener } from '../utils/Emitter';
import { clamp, wrap } from '../utils/math';
import type { Vec3 } from '../utils/vec3';
import { FollowerRider, type RiderOptions } from './FollowerRider';
import type { OrientationOptions } from './orientation';

/** Where a follower starts. See `PathFollowerOptions.startFrom`. */
export type FollowerStart = 'path' | 'closest' | 'object';

export interface PathFollowerEvents extends PathCursorEvents {
  /** The lead-in leg (`startFrom: 'object'`) reached the path. */
  enter: { distance: number };
}

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
  /**
   * Where the follower starts:
   * - 'path' (default): at `startProgress` on the path.
   * - 'closest': at the point on the path nearest the object's current
   *   position, so picking a path up mid-scene does not jump the object.
   * - 'object': the object stays where it is and runs a straight lead-in leg
   *   onto the path, at the speed the path opens with. `enter` fires when it
   *   arrives, and travel along the path starts from `startProgress`.
   */
  startFrom?: FollowerStart;
  /**
   * What rotation smoothing eases from on the first frame: 'path' (default,
   * snaps onto the path's heading) or 'object' (the object's current rotation,
   * so an object that starts on another heading turns instead of flicking).
   */
  initialRotation?: 'path' | 'object';
  /** Objects carried along the same path at an offset. See `addRider`. */
  riders?: RiderOptions[];
  onProgress?: Listener<PathCursorEvents['progress']>;
  onWaypoint?: Listener<PathCursorEvents['waypoint']>;
  onLoop?: Listener<PathCursorEvents['loop']>;
  onComplete?: Listener<void>;
  /** Playback started (`play()`). See `PathCursorEvents.play`. */
  onPlay?: Listener<void>;
  /** Playback stopped (`pause()` or the end with loop 'none'). See `PathCursorEvents.pause`. */
  onPause?: Listener<void>;
  /** `reset()` was called. See `PathCursorEvents.reset`. */
  onReset?: Listener<void>;
  /** The lead-in leg reached the path. See `PathFollowerEvents.enter`. */
  onEnter?: Listener<PathFollowerEvents['enter']>;
}

/** Straight lead-in leg from where the object stood onto the path. */
interface Entry {
  readonly from: Vector3;
  readonly to: Vector3;
  readonly length: number;
  travelled: number;
}

const _pos = new Vector3();
const _local = new Vector3();
const _dir = new Vector3();
const _right = new Vector3();
const _q = new Quaternion();
const _parentQ = new Quaternion();
const _point: Vec3 = [0, 0, 0];
const _world: Vec3 = [0, 0, 0];

/**
 * Moves (and optionally rotates) an Object3D along a Path. Call `update(dt)`
 * from your existing render/update loop — the follower has no loop of its own.
 */
export class PathFollower {
  readonly object: Object3D;
  readonly cursor: PathCursor;
  coordinates: CoordinateSystem;
  space: 'world' | 'parent';
  faceTravelDirection: boolean;
  positionOffset: Vector3;

  private readonly lead: FollowerRider;
  private readonly riderList: FollowerRider[] = [];
  // Leader first, then riders: iterated every frame, so it is kept as a plain
  // array rather than rebuilt per call.
  private readonly posed: FollowerRider[] = [];
  private readonly ownEvents = new Emitter<Pick<PathFollowerEvents, 'enter'>>();
  private entry: Entry | null = null;

  constructor(options: PathFollowerOptions) {
    this.object = options.object;
    this.cursor = new PathCursor(options);
    this.lead = new FollowerRider({ object: options.object, orientation: options.orientation });
    this.posed.push(this.lead);
    this.coordinates = options.coordinates ?? defaultCoordinateSystem;
    this.space = options.space ?? 'world';
    this.faceTravelDirection = options.faceTravelDirection ?? true;
    this.positionOffset = new Vector3(...(options.positionOffset ?? [0, 0, 0]));
    // The seed is restored after the first pose is written: that write has no
    // frame time to smooth over and would otherwise snap the rotation.
    const seed = options.initialRotation === 'object' ? options.object.quaternion.clone() : null;
    this.start(options.startFrom ?? 'path');
    if (seed) this.seedRotation(seed);
    for (const rider of options.riders ?? []) this.addRider(rider);
    if (options.onProgress) this.on('progress', options.onProgress);
    if (options.onWaypoint) this.on('waypoint', options.onWaypoint);
    if (options.onLoop) this.on('loop', options.onLoop);
    if (options.onComplete) this.on('complete', options.onComplete);
    if (options.onPlay) this.on('play', options.onPlay);
    if (options.onPause) this.on('pause', options.onPause);
    if (options.onReset) this.on('reset', options.onReset);
    if (options.onEnter) this.on('enter', options.onEnter);
  }

  /** The leader's orientation settings (shared by riders that don't bring their own). */
  get orienter(): FollowerRider['orienter'] {
    return this.lead.orienter;
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
  /** True while the object is still running its lead-in leg onto the path. */
  get isEntering(): boolean {
    return this.entry !== null;
  }

  /**
   * Subscribes to a follower event (the cursor's progress, waypoint, loop,
   * complete, play, pause, reset, plus the follower's own enter). Returns an
   * unsubscribe function.
   */
  on<K extends keyof PathFollowerEvents>(type: K, listener: Listener<PathFollowerEvents[K]>): () => void {
    if (type === 'enter') return this.ownEvents.on('enter', listener as Listener<PathFollowerEvents['enter']>);
    // Every other type is the cursor's; 'enter' is the only one it does not have.
    const events = this.cursor.events as unknown as Emitter<PathFollowerEvents>;
    return events.on(type, listener);
  }

  /**
   * Subscribes until the first event `filter` accepts, then unsubscribes, e.g.
   * the next time a named waypoint is reached:
   * `follower.once('waypoint', run, (e) => e.waypoint.metadata.name === 'gate')`.
   */
  once<K extends keyof PathFollowerEvents>(
    type: K,
    listener: Listener<PathFollowerEvents[K]>,
    filter?: (payload: PathFollowerEvents[K]) => boolean,
  ): () => void {
    const off = this.on(type, (payload) => {
      if (filter && !filter(payload)) return;
      off();
      listener(payload);
    });
    return off;
  }

  play(): this {
    this.cursor.play();
    return this;
  }

  pause(): this {
    this.cursor.pause();
    return this;
  }

  /** Back to the start and snap the object there. Drops a pending lead-in. */
  reset(): this {
    this.cursor.reset();
    this.entry = null;
    for (const target of this.posed) target.hasRotation = false;
    this.apply();
    return this;
  }

  /** Jump to normalized progress [0, 1] and apply immediately. */
  setProgress(progress: number, options?: SeekOptions): this {
    this.cursor.seekProgress(progress, options);
    this.apply();
    return this;
  }

  setDistance(distance: number, options?: SeekOptions): this {
    this.cursor.seek(distance, options);
    this.apply();
    return this;
  }

  /**
   * Jump to a waypoint, by index or `metadata.name`. Returns false (and moves
   * nothing) when the path has no such waypoint. Pass
   * `{ emitWaypoints: true }` to let listeners hear about the points skipped.
   */
  setWaypoint(target: WaypointTarget, options?: SeekOptions): boolean {
    if (!this.cursor.seekWaypoint(target, options)) return false;
    this.apply();
    return true;
  }

  /**
   * Jump to an authored time on the path (see `Waypoint.time`). Returns false
   * when the path has no timeline. Two paths authored with the same times stay
   * in step when both are sampled at the same time.
   */
  setTime(time: number, options?: SeekOptions): boolean {
    if (!this.cursor.seekTime(time, options)) return false;
    this.apply();
    return true;
  }

  /** The authored time the follower currently sits at. See `Waypoint.time`. */
  get time(): number {
    return this.cursor.time;
  }

  /** See `PathCursor.hasPassed`. */
  hasPassed(target: WaypointTarget): boolean {
    return this.cursor.hasPassed(target);
  }

  setPath(path: Path): this {
    this.cursor.setPath(path);
    this.apply();
    return this;
  }

  /**
   * Heading of the object around the orientation's world up, in radians, as
   * `setYaw` takes it. Read this instead of `object.rotation.y`, which is
   * mirrored for headings outside ±90°.
   */
  get yaw(): number {
    return this.orienter.yawOf(this.object.quaternion);
  }

  /** Faces the object at `yaw` (radians) and lets smoothing ease on from there. */
  setYaw(yaw: number): this {
    if (!this.orienter.yawTo(yaw, _q)) return this;
    const parent = this.space === 'world' ? this.object.parent : null;
    if (parent) _q.premultiply(parent.getWorldQuaternion(_parentQ).invert());
    this.lead.seedRotation(_q);
    this.object.quaternion.copy(_q);
    return this;
  }

  /**
   * Sets the rotation smoothing eases on from, and puts the object there.
   * Without it the first frame snaps onto the path's heading.
   */
  seedRotation(rotation: Quaternion): this {
    this.lead.seedRotation(rotation);
    this.object.quaternion.copy(this.lead.rotation);
    return this;
  }

  // Riders --------------------------------------------------------------------

  /**
   * Carries another object along the same path at an offset (convoy, flock,
   * trailing camera). Riders share this follower's cursor, so speed, loops and
   * events are integrated once.
   */
  addRider(options: RiderOptions): FollowerRider {
    const rider = new FollowerRider(options, this.lead.orienter);
    this.riderList.push(rider);
    this.posed.push(rider);
    return rider;
  }

  removeRider(rider: FollowerRider): void {
    const index = this.riderList.indexOf(rider);
    if (index >= 0) this.riderList.splice(index, 1);
    const posedIndex = this.posed.indexOf(rider);
    if (posedIndex >= 0) this.posed.splice(posedIndex, 1);
  }

  get riders(): readonly FollowerRider[] {
    return this.riderList;
  }

  /** Advance by `dt` seconds and write the pose to the object(s). */
  update(dt: number): this {
    let travel = dt;
    if (this.entry) {
      travel = this.advanceEntry(dt);
      if (this.entry) {
        this.apply(dt);
        return this;
      }
    }
    this.cursor.advance(travel);
    this.apply(dt);
    return this;
  }

  /** Writes the current pose to the object(s) without advancing. */
  apply(dt = 0): this {
    if (this.cursor.path.waypoints.length === 0) return this;
    const entry = this.entry;
    for (let i = 0; i < this.posed.length; i++) {
      const target = this.posed[i];
      if (entry) this.applyEntry(target, entry, dt);
      else this.applyPath(target, dt);
    }
    return this;
  }

  /** Removes event listeners and riders. Does not touch the objects. */
  dispose(): void {
    this.cursor.events.clear();
    this.ownEvents.clear();
    this.riderList.length = 0;
    this.posed.length = 1;
  }

  // Internal ------------------------------------------------------------------

  private start(from: FollowerStart): void {
    if (from === 'path') {
      this.apply();
      return;
    }
    const path = this.cursor.path;
    this.object.getWorldPosition(_pos);
    if (from === 'closest') {
      if (path.waypoints.length > 0) {
        _pos.sub(this.positionOffset).toArray(_world);
        this.cursor.seekProgress(path.getClosestPoint(this.coordinates.toPath(_world, path.dimension, _point)).u);
      }
      this.apply();
      return;
    }
    // 'object': keep the object where it stands and run a lead-in leg onto the
    // path. Zero length (already on it) starts on the path straight away.
    const to = new Vector3();
    if (path.waypoints.length > 0) {
      to.fromArray(this.coordinates.toWorld(path.getPointAtDistance(this.cursor.distance, _point), path.dimension, _world))
        .add(this.positionOffset);
    }
    const length = _pos.distanceTo(to);
    if (length > 1e-6) this.entry = { from: _pos.clone(), to, length, travelled: 0 };
    this.apply();
  }

  /** Advances the lead-in; returns the time left over once it reaches the path. */
  private advanceEntry(dt: number): number {
    const entry = this.entry!;
    if (!this.cursor.playing || dt <= 0) return 0;
    const speed = this.cursor.currentSpeed;
    entry.travelled += speed * dt;
    if (entry.travelled < entry.length) return 0;
    const overshoot = entry.travelled - entry.length;
    this.entry = null;
    this.ownEvents.emit('enter', { distance: this.cursor.distance });
    return speed > 0 ? Math.min(overshoot / speed, dt) : 0;
  }

  private applyEntry(target: FollowerRider, entry: Entry, dt: number): void {
    const along = clamp(entry.travelled - target.offset, 0, entry.length);
    _pos.lerpVectors(entry.from, entry.to, entry.length > 0 ? along / entry.length : 1).add(this.positionOffset);
    _dir.subVectors(entry.to, entry.from);
    this.offsetLaterally(target, _pos, _dir);
    this.writePose(target, _pos, _dir, target.orienter.enabled, 0, dt);
  }

  private applyPath(target: FollowerRider, dt: number): void {
    const path = this.cursor.path;
    const d = this.distanceFor(target.offset);
    _pos.fromArray(this.coordinates.toWorld(path.getPointAtDistance(d, _point), path.dimension, _world))
      .add(this.positionOffset);

    const orient = target.orienter.enabled && path.waypoints.length > 1;
    const lateral = target.lateral[0] !== 0 || target.lateral[1] !== 0;
    let roll = 0;
    if (orient || lateral) {
      _dir.fromArray(this.coordinates.directionToWorld(path.getTangentAtDistance(d, _point), path.dimension, _world));
      const backwards = this.faceTravelDirection && this.cursor.direction < 0;
      if (backwards) _dir.negate();
      // Travelling backwards mirrors the turns, so mirror the bank too.
      roll = ((this.rollAt(d) * Math.PI) / 180) * (backwards ? -1 : 1);
      this.offsetLaterally(target, _pos, _dir);
    }
    this.writePose(target, _pos, _dir, orient, roll, dt);
  }

  /** Writes a world position and heading onto the target, in its own frame. */
  private writePose(
    target: FollowerRider,
    position: Vector3,
    direction: Vector3,
    orient: boolean,
    roll: number,
    dt: number,
  ): void {
    const object = target.object;
    const parent = this.space === 'world' ? object.parent : null;
    if (parent) {
      parent.updateWorldMatrix(true, false);
      object.position.copy(parent.worldToLocal(_local.copy(position)));
    } else {
      object.position.copy(position);
    }
    if (!orient || !target.orienter.compute(direction, _q, roll)) return;
    if (parent) _q.premultiply(parent.getWorldQuaternion(_parentQ).invert());
    const smoothing = target.orienter.smoothing;
    if (smoothing > 0 && target.hasRotation && dt > 0) {
      target.rotation.slerp(_q, 1 - Math.exp(-smoothing * dt));
    } else {
      target.rotation.copy(_q);
    }
    target.hasRotation = true;
    object.quaternion.copy(target.rotation);
  }

  private offsetLaterally(target: FollowerRider, position: Vector3, direction: Vector3): void {
    const [right, up] = target.lateral;
    if (right === 0 && up === 0) return;
    const worldUp = target.orienter.worldUp;
    _right.crossVectors(worldUp, direction);
    if (_right.lengthSq() > 1e-12) position.addScaledVector(_right.normalize(), right);
    position.addScaledVector(worldUp, up);
  }

  /** Where a target sits on the path: `offset` units behind the leader. */
  private distanceFor(offset: number): number {
    if (offset === 0) return this.cursor.distance;
    const length = this.cursor.path.length;
    const d = this.cursor.distance - this.cursor.direction * offset;
    return this.cursor.loop === 'loop' && length > 0 ? wrap(d, length) : clamp(d, 0, length);
  }

  private rollAt(distance: number): number {
    const o = this.lead.orienter;
    const path = this.cursor.path;
    if (!o.applyRoll || !path.hasWaypointValues('roll')) return 0;
    return path.getWaypointValueAtDistance('roll', distance, this.cursor.interpolation) * o.rollScale;
  }
}
