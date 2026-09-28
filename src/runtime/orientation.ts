import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { Vec3 } from '../core/types';

export interface OrientationOptions {
  /** Rotate the object to follow the path tangent. Default true. */
  enabled?: boolean;
  /**
   * The model's local forward axis. Default [0, 0, 1] (+Z, matches Object3D.lookAt).
   * Use e.g. [1, 0, 0] for models that face +X, [0, 0, -1] for models facing -Z.
   */
  forward?: Vec3;
  /** The model's local up axis. Default [0, 1, 0]. */
  up?: Vec3;
  /** World up used to keep the object upright. Default [0, 1, 0]. */
  worldUp?: Vec3;
  /** Ignore pitch: only rotate around `worldUp` (cars, characters). Default false. */
  yawOnly?: boolean;
  /** Extra rotation in model space (Euler XYZ, radians), e.g. to compensate a tilted model. */
  offset?: Vec3;
  /**
   * Rotation smoothing rate (1/seconds). 0 = snap instantly (default).
   * Higher values converge faster, e.g. 8.
   */
  smoothing?: number;
  /** Apply per-waypoint `roll` (bank) angles. Default true. */
  applyRoll?: boolean;
  /** Multiplies all waypoint roll angles (e.g. 0.5 for a calmer model, -1 to flip). Default 1. */
  rollScale?: number;
}

const _basis = new Matrix4();
const _f = new Vector3();
const _r = new Vector3();
const _u = new Vector3();
const _roll = new Quaternion();

/**
 * Computes a world rotation that maps the model's forward axis onto a travel
 * direction, keeping the model's up axis aligned with worldUp.
 */
export class Orienter {
  enabled: boolean;
  smoothing: number;
  yawOnly: boolean;
  applyRoll: boolean;
  rollScale: number;
  private readonly worldUp: Vector3;
  /** inverse(model basis) * offset, precomputed. */
  private readonly modelCorrection = new Quaternion();

  constructor(options: OrientationOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.smoothing = options.smoothing ?? 0;
    this.yawOnly = options.yawOnly ?? false;
    this.applyRoll = options.applyRoll ?? true;
    this.rollScale = options.rollScale ?? 1;
    this.worldUp = new Vector3(...(options.worldUp ?? [0, 1, 0])).normalize();

    const fm = new Vector3(...(options.forward ?? [0, 0, 1])).normalize();
    const um = new Vector3(...(options.up ?? [0, 1, 0]));
    const rm = new Vector3().crossVectors(um, fm);
    if (rm.lengthSq() < 1e-12) throw new Error('Orientation: `forward` and `up` must not be parallel.');
    rm.normalize();
    um.crossVectors(fm, rm);
    const modelQ = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(rm, um, fm));
    this.modelCorrection.copy(modelQ).invert();
    if (options.offset) {
      const offsetQ = new Quaternion().setFromEuler(new Euler(...options.offset));
      this.modelCorrection.multiply(offsetQ);
    }
  }

  /**
   * Writes the target world rotation for a travel direction into `target`.
   * Returns false (leaving `target` untouched) when the direction is degenerate,
   * e.g. zero length or parallel to worldUp.
   *
   * `roll` (radians) banks around the travel direction; positive banks right
   * (the object's right side goes down).
   */
  compute(direction: Vector3, target: Quaternion, roll = 0): boolean {
    _f.copy(direction);
    if (this.yawOnly) _f.addScaledVector(this.worldUp, -_f.dot(this.worldUp));
    if (_f.lengthSq() < 1e-12) return false;
    _f.normalize();
    _r.crossVectors(this.worldUp, _f);
    if (_r.lengthSq() < 1e-12) return false;
    _r.normalize();
    _u.crossVectors(_f, _r);
    target.setFromRotationMatrix(_basis.makeBasis(_r, _u, _f)).multiply(this.modelCorrection);
    if (roll !== 0) target.premultiply(_roll.setFromAxisAngle(_f, roll));
    return true;
  }
}
