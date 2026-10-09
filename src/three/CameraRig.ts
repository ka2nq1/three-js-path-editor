import { BufferGeometry, Float32BufferAttribute, Group, LineSegments, Vector3, type LineBasicMaterial } from 'three';
import type { CoordinateSystem } from '../core/coordinates';
import type { Path } from '../core/Path';
import type { Vec3 } from '../utils/vec3';

export interface CameraRigOptions {
  /** Id of the path the camera travels along. */
  path: string;
  /** Id of the path whose matching point the camera looks at. */
  lookAt: string;
  /** Default: `<path>→<lookAt>`. */
  id?: string;
  /**
   * Flight duration in seconds, used when the two paths carry no authored
   * times. Default 10.
   */
  duration?: number;
}

const _point: Vec3 = [0, 0, 0];
const _from = new Vector3();
const _to = new Vector3();

/**
 * A camera path paired with the path it looks at. The two are sampled at the
 * same point of one shared parameter — authored `time` when both paths carry
 * it, normalized arc length otherwise — because waypoint N of one path has
 * nothing to do with waypoint N of the other.
 *
 * The rig draws sight lines between the matching points and can fly the
 * editor's own camera along it, which is the only way to see the framing
 * without restarting the game.
 */
export class CameraRig {
  readonly id: string;
  readonly group = new Group();
  pathId: string;
  lookAtPathId: string;
  duration: number;

  /** The sight lines themselves; restyle their material if you like. */
  readonly lines: LineSegments;
  private readonly resolve: (id: string) => Path | undefined;
  private readonly coordinates: CoordinateSystem;
  private builtFor = '';

  constructor(
    options: CameraRigOptions,
    context: { resolve: (id: string) => Path | undefined; coordinates: CoordinateSystem; material: LineBasicMaterial },
  ) {
    this.pathId = options.path;
    this.lookAtPathId = options.lookAt;
    this.id = options.id ?? `${options.path}→${options.lookAt}`;
    this.duration = options.duration ?? 10;
    this.resolve = context.resolve;
    this.coordinates = context.coordinates;
    this.group.name = `PathEditor:rig:${this.id}`;
    this.group.userData.pathEditor = true;
    this.lines = new LineSegments(new BufferGeometry(), context.material);
    this.lines.userData.pathEditor = true;
    this.group.add(this.lines);
  }

  get path(): Path | undefined {
    return this.resolve(this.pathId);
  }

  get lookAtPath(): Path | undefined {
    return this.resolve(this.lookAtPathId);
  }

  /** True when both paths carry authored times, so the rig runs on them. */
  get timed(): boolean {
    return this.path?.timeRange != null && this.lookAtPath?.timeRange != null;
  }

  /** Seconds the flight takes: the authored time span, or `duration`. */
  get flightTime(): number {
    const authored = this.timed ? this.path!.duration : 0;
    return authored > 0 ? authored : this.duration;
  }

  /**
   * Camera position and aim at `u` in [0, 1] of the rig's shared parameter.
   * False when either path is missing or empty.
   */
  sample(u: number, position: Vector3, lookAt: Vector3): boolean {
    const path = this.path;
    const aim = this.lookAtPath;
    if (!path?.waypoints.length || !aim?.waypoints.length) return false;
    const range = this.timed ? path.timeRange : null;
    if (range) {
      const time = range.start + (range.end - range.start) * u;
      position.fromArray(this.coordinates.toWorld(path.getPointAtTime(time, _point), path.dimension));
      lookAt.fromArray(this.coordinates.toWorld(aim.getPointAtTime(time, _point), aim.dimension));
    } else {
      position.fromArray(this.coordinates.toWorld(path.getPointAt(u, _point), path.dimension));
      lookAt.fromArray(this.coordinates.toWorld(aim.getPointAt(u, _point), aim.dimension));
    }
    return true;
  }

  /** Rebuilds the sight lines when either path changed. */
  update(visible: boolean): void {
    this.group.visible = visible;
    const path = this.path;
    const aim = this.lookAtPath;
    const signature = visible ? `${path?.version ?? -1}:${aim?.version ?? -1}` : '';
    if (signature === this.builtFor) return;
    this.builtFor = signature;
    const positions: number[] = [];
    if (visible && path && aim) {
      // One line per camera waypoint: where the camera is, and what it sees
      // from there.
      const count = path.waypoints.length;
      for (let i = 0; i < count; i++) {
        const u = count > 1 ? i / (count - 1) : 0;
        if (!this.sample(u, _from, _to)) break;
        positions.push(_from.x, _from.y, _from.z, _to.x, _to.y, _to.z);
      }
    }
    const geometry = this.lines.geometry;
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.computeBoundingSphere();
  }

  dispose(): void {
    this.lines.geometry.dispose();
    this.group.removeFromParent();
  }
}
