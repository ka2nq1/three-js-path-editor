import { Emitter } from '../utils/Emitter';
import { clamp } from '../utils/math';
import type { Path } from './Path';
import type { WaypointInterpolation } from './types';
import type { Waypoint } from './Waypoint';

export type LoopMode = 'none' | 'loop' | 'pingpong';

export interface SpeedContext {
  path: Path;
  /** Normalized progress in [0, 1]. */
  progress: number;
  distance: number;
  direction: 1 | -1;
}

export interface PathCursorOptions {
  path: Path;
  /** World/path units per second. Default 1. */
  speed?: number;
  /** `true` = 'loop'. Default 'none'. */
  loop?: boolean | LoopMode;
  /** Initial normalized progress. Default 0 (or 1 when direction is -1). */
  startProgress?: number;
  /** 1 = forward, -1 = backward. Default 1. */
  direction?: 1 | -1;
  /** Start moving immediately on `advance()`. Default true. */
  autoPlay?: boolean;
  /** Optional speed multiplier evaluated every step (e.g. slow down near the end). */
  speedModifier?: (ctx: SpeedContext) => number;
  /** Apply per-waypoint `speed` multipliers. Default true. */
  useWaypointSpeed?: boolean;
  /** How waypoint values (speed, roll) blend between waypoints. Default 'smooth'. */
  interpolation?: WaypointInterpolation;
}

/** Waypoint speed multipliers are clamped to this so a 0 never stalls the cursor forever. */
export const MIN_WAYPOINT_SPEED = 0.01;
/** Max integration step when speed varies along the path. */
const MAX_SUBSTEP = 1 / 60;
const DISTANCE_EPSILON = 1e-9;

/** A waypoint by index, or by its `metadata.name`. */
export type WaypointTarget = number | string;

export interface SeekOptions {
  /**
   * Emit `waypoint` for every waypoint the jump passed over. Off by default:
   * a seek is a cut, not travel, so listeners waiting for a point would
   * otherwise never hear about it.
   */
  emitWaypoints?: boolean;
}

export interface PathCursorEvents {
  /** After every `advance()` that moved the cursor. */
  progress: { progress: number; distance: number };
  /** The cursor reached (or passed) a waypoint. */
  waypoint: { index: number; waypoint: Waypoint; distance: number };
  /** Looped back to start ('loop') or turned around ('pingpong'). */
  loop: { count: number; direction: 1 | -1 };
  /** Reached the end with loop mode 'none'. Followed by `pause`. */
  complete: void;
  /** `playing` went false -> true (`play()`). Not emitted for `autoPlay` at construction. */
  play: void;
  /**
   * `playing` went true -> false: `pause()`, or the automatic stop at the end
   * with loop mode 'none' (emitted right after `complete`, with `playing` already false).
   */
  pause: void;
  /**
   * `reset()` was called (also by `play()` restarting a completed cursor, before `play`).
   * Seeking with `progress`/`distance`/`setPath` does not emit it.
   */
  reset: void;
}

/**
 * Tracks travel along a path by distance (constant speed), handling speed,
 * looping and events. Three.js-independent; `PathFollower` applies it to an Object3D.
 */
export class PathCursor {
  readonly events = new Emitter<PathCursorEvents>();
  path: Path;
  speed: number;
  loop: LoopMode;
  direction: 1 | -1;
  speedModifier?: (ctx: SpeedContext) => number;
  useWaypointSpeed: boolean;
  interpolation: WaypointInterpolation;
  loopCount = 0;

  private _distance = 0;
  private _playing: boolean;
  private _complete = false;
  private readonly startProgress: number;
  private readonly startDirection: 1 | -1;

  constructor(options: PathCursorOptions) {
    this.path = options.path;
    this.speed = options.speed ?? 1;
    this.loop = options.loop === true ? 'loop' : options.loop === false || options.loop === undefined ? 'none' : options.loop;
    this.direction = options.direction ?? 1;
    this.startDirection = this.direction;
    this.speedModifier = options.speedModifier;
    this.useWaypointSpeed = options.useWaypointSpeed ?? true;
    this.interpolation = options.interpolation ?? 'smooth';
    this._playing = options.autoPlay ?? true;
    this.startProgress = options.startProgress ?? (this.direction === 1 ? 0 : 1);
    this._distance = clamp(this.startProgress, 0, 1) * this.path.length;
  }

  get distance(): number {
    return clamp(this._distance, 0, this.path.length);
  }

  set distance(value: number) {
    this._distance = clamp(value, 0, this.path.length);
    this._complete = false;
  }

  /** Normalized progress in [0, 1]. */
  get progress(): number {
    const length = this.path.length;
    return length > 0 ? this.distance / length : 0;
  }

  set progress(value: number) {
    this.distance = clamp(value, 0, 1) * this.path.length;
  }

  get playing(): boolean {
    return this._playing;
  }

  get complete(): boolean {
    return this._complete;
  }

  /** Starts moving. A completed cursor restarts from the beginning. Emits `play` if it was stopped. */
  play(): void {
    if (this._complete) this.reset();
    if (this._playing) return;
    this._playing = true;
    this.events.emit('play', undefined);
  }

  /** Stops moving. Emits `pause` if it was playing. */
  pause(): void {
    if (!this._playing) return;
    this._playing = false;
    this.events.emit('pause', undefined);
  }

  /** Back to the start position and direction. Keeps play state. Emits `reset`. */
  reset(): void {
    this.direction = this.startDirection;
    this.loopCount = 0;
    this._complete = false;
    this._distance = clamp(this.startProgress, 0, 1) * this.path.length;
    this.events.emit('reset', undefined);
  }

  /**
   * Jumps to a distance along the path. With `emitWaypoints` the waypoints
   * between the old and the new position are emitted, in travel order.
   */
  seek(distance: number, options: SeekOptions = {}): this {
    const from = this._distance;
    this.distance = distance;
    if (options.emitWaypoints) this.emitCrossings(from, this._distance);
    return this;
  }

  /** Jumps to normalized progress [0, 1]. See `seek`. */
  seekProgress(progress: number, options?: SeekOptions): this {
    return this.seek(clamp(progress, 0, 1) * this.path.length, options);
  }

  /**
   * Jumps to an authored time on the path (see `Waypoint.time`). Returns false
   * (and does nothing) when the path has no timeline. See `seek`.
   */
  seekTime(time: number, options?: SeekOptions): boolean {
    if (!this.path.timeRange) return false;
    this.seek(this.path.distanceAtTime(time), options);
    return true;
  }

  /** The authored time the cursor currently sits at, or 0 without a timeline. */
  get time(): number {
    return this.path.timeAtDistance(this.distance);
  }

  /**
   * Jumps to a waypoint, by index or `metadata.name`. Returns false (and does
   * nothing) when the path has no such waypoint. See `seek`.
   */
  seekWaypoint(target: WaypointTarget, options?: SeekOptions): boolean {
    const distance = this.path.distanceOfWaypoint(target);
    if (distance === undefined) return false;
    this.seek(distance, options);
    return true;
  }

  /**
   * True when the cursor sits at or beyond a waypoint in its current travel
   * direction. It describes the current position, not history: a loop or a
   * backward seek makes it false again.
   */
  hasPassed(target: WaypointTarget): boolean {
    const distance = this.path.distanceOfWaypoint(target);
    if (distance === undefined) return false;
    return this.direction > 0
      ? this.distance >= distance - DISTANCE_EPSILON
      : this.distance <= distance + DISTANCE_EPSILON;
  }

  /** Switches path while keeping normalized progress. */
  setPath(path: Path): void {
    const progress = this.progress;
    this.path = path;
    this._distance = progress * path.length;
  }

  /** Current speed in units/second (base speed × modifier × waypoint speed). */
  get currentSpeed(): number {
    return Math.abs(this.speed * this.multiplierAt());
  }

  /** Advances by `dt` seconds. Returns true if the cursor moved. */
  advance(dt: number): boolean {
    const length = this.path.length;
    if (!this._playing || this._complete || length <= 0 || dt <= 0) return false;
    this._distance = clamp(this._distance, 0, length);
    // Speed can change along the path, so integrate in small steps.
    const variable = this.useWaypointSpeed && this.path.hasWaypointValues('speed');
    const steps = variable ? Math.min(Math.ceil(dt / MAX_SUBSTEP), 600) : 1;
    const h = dt / steps;
    let moved = false;
    for (let i = 0; i < steps && this._playing && !this._complete; i++) {
      const step = Math.abs(this.speed * this.multiplierAt() * h);
      if (step > 0) moved = this.move(step, length) || moved;
    }
    if (!moved) return false;
    if (!this._complete) this.emitProgress();
    return true;
  }

  private multiplierAt(): number {
    let m = this.speedModifier
      ? this.speedModifier({ path: this.path, progress: this.progress, distance: this.distance, direction: this.direction })
      : 1;
    if (this.useWaypointSpeed && this.path.hasWaypointValues('speed')) {
      m *= Math.max(MIN_WAYPOINT_SPEED, this.path.getWaypointValueAtDistance('speed', this.distance, this.interpolation));
    }
    return m;
  }

  /** Moves `amount` along the path, handling ends/loops. Emits complete. */
  private move(amount: number, length: number): boolean {
    let remaining = amount;
    // Walk to the end, handle loop behaviour, repeat while distance remains.
    for (let guard = 0; remaining > 0 && guard < 10_000; guard++) {
      const end = this.direction > 0 ? length : 0;
      const room = Math.abs(end - this._distance);
      if (remaining < room) {
        const from = this._distance;
        this._distance += this.direction * remaining;
        this.emitCrossings(from, this._distance);
        break;
      }
      this.emitCrossings(this._distance, end);
      this._distance = end;
      remaining -= room;

      if (this.loop === 'none') {
        this._complete = true;
        this._playing = false;
        this.emitProgress();
        this.events.emit('complete', undefined);
        // Skipped if a complete listener already restarted playback.
        if (!this._playing) this.events.emit('pause', undefined);
        return true;
      }
      this.loopCount++;
      if (this.loop === 'loop') {
        this._distance = this.direction > 0 ? 0 : length;
        this.emitAt(this._distance);
      } else {
        this.direction = this.direction > 0 ? -1 : 1;
      }
      this.events.emit('loop', { count: this.loopCount, direction: this.direction });
    }
    return true;
  }

  private emitProgress(): void {
    this.events.emit('progress', { progress: this.progress, distance: this.distance });
  }

  /** Emits 'waypoint' for waypoints in (from, to] (forward) or [to, from) (backward). */
  private emitCrossings(from: number, to: number): void {
    const distances = this.path.getWaypointDistances();
    const eps = DISTANCE_EPSILON;
    const forward = to >= from;
    const n = distances.length;
    for (let k = 0; k < n; k++) {
      const i = forward ? k : n - 1 - k;
      const d = distances[i];
      const crossed = forward ? d > from + eps && d <= to + eps : d < from - eps && d >= to - eps;
      if (crossed) this.emitWaypoint(i, d);
    }
  }

  private emitAt(position: number): void {
    const distances = this.path.getWaypointDistances();
    for (let i = 0; i < distances.length; i++) {
      if (Math.abs(distances[i] - position) < DISTANCE_EPSILON) this.emitWaypoint(i, distances[i]);
    }
  }

  private emitWaypoint(index: number, distance: number): void {
    this.events.emit('waypoint', { index, waypoint: this.path.waypoints[index], distance });
  }
}
