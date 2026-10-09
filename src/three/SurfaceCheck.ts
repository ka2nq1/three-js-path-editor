import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineSegments,
  Raycaster,
  Vector3,
  type LineBasicMaterial,
  type Object3D,
} from 'three';
import type { CoordinateSystem } from '../core/coordinates';
import type { Path } from '../core/Path';
import { isEditorObject, pathUp } from './placement';

export interface SurfaceCheckOptions {
  /** Floors, terrain, roads — whatever the paths are authored on. */
  objects: Object3D[] | (() => Object3D[]);
  /** How far under the surface counts as sagging, in world units. Default 0.05. */
  tolerance?: number;
  /** How far above a sample the downward ray starts. Default 10000. */
  castHeight?: number;
  /** Samples per curve segment. Default 16. */
  samplesPerSegment?: number;
}

const _from = new Vector3();
const _sample = new Vector3();

/**
 * Marks the spans where a path runs below the surface its waypoints sit on.
 * A spline through points on a floor overshoots in height where a flat stretch
 * meets a climb and dips under it, which is invisible in the editor until
 * something walks the route — `curve.linearHeight` is the fix.
 */
export class SurfaceCheck {
  readonly group = new Group();
  /** The warning ticks themselves; restyle their material if you like. */
  readonly lines: LineSegments;
  private readonly raycaster = new Raycaster();
  private readonly coordinates: CoordinateSystem;
  private readonly options: Required<Omit<SurfaceCheckOptions, 'objects'>> & Pick<SurfaceCheckOptions, 'objects'>;
  private builtFor = '';

  constructor(options: SurfaceCheckOptions, context: { coordinates: CoordinateSystem; material: LineBasicMaterial }) {
    this.coordinates = context.coordinates;
    this.options = {
      objects: options.objects,
      tolerance: options.tolerance ?? 0.05,
      castHeight: options.castHeight ?? 10000,
      samplesPerSegment: options.samplesPerSegment ?? 16,
    };
    this.group.name = 'PathEditorSurfaceCheck';
    this.group.userData.pathEditor = true;
    this.lines = new LineSegments(new BufferGeometry(), context.material);
    this.lines.userData.pathEditor = true;
    this.group.add(this.lines);
  }

  /** Rebuilds the markers when a path changed, the set changed or it was switched on. */
  update(paths: readonly Path[], visible: boolean): void {
    this.group.visible = visible;
    const signature = visible ? paths.map((path) => `${path.id}:${path.version}`).join('|') : '';
    if (signature === this.builtFor) return;
    this.builtFor = signature;
    const positions: number[] = [];
    if (visible) for (const path of paths) this.checkPath(path, positions);
    const geometry = this.lines.geometry;
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.computeBoundingSphere();
  }

  dispose(): void {
    this.lines.geometry.dispose();
    this.group.removeFromParent();
  }

  /** A vertical tick from the curve up to the surface for every sample below it. */
  private checkPath(path: Path, positions: number[]): void {
    if (path.isMarker || path.waypoints.length < 2) return;
    const { tolerance, castHeight, samplesPerSegment } = this.options;
    const objects = typeof this.options.objects === 'function' ? this.options.objects() : this.options.objects;
    if (objects.length === 0) return;
    const up = pathUp(this.coordinates, path.dimension, _from).clone();
    const down = up.clone().negate();
    const steps = Math.max(1, path.segmentCount) * samplesPerSegment;
    this.raycaster.far = castHeight * 2;
    for (let i = 0; i <= steps; i++) {
      _sample.fromArray(this.coordinates.toWorld(path.getPoint(i / steps), path.dimension));
      this.raycaster.set(_from.copy(_sample).addScaledVector(up, castHeight), down);
      const hit = this.raycaster.intersectObjects(objects, true).find((candidate) => !isEditorObject(candidate.object));
      if (!hit) continue;
      const depth = hit.point.clone().sub(_sample).dot(up);
      if (depth <= tolerance) continue;
      positions.push(_sample.x, _sample.y, _sample.z, hit.point.x, hit.point.y, hit.point.z);
    }
  }
}
