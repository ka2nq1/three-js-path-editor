/** Plain 3-component vector used by the Three.js-independent core. */
export type Vec3 = [number, number, number];

export const EPSILON = 1e-9;

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return [x, y, z];
}

/** Converts a 2- or 3-component array into a Vec3 (missing components become 0). */
export function toVec3(source: ArrayLike<number>): Vec3 {
  return [num(source[0]), num(source[1]), num(source[2])];
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function addScaled(a: Vec3, b: Vec3, s: number): Vec3 {
  return [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Returns a unit vector, or [0, 0, 0] for (near) zero-length input. */
export function normalize(a: Vec3): Vec3 {
  const len = length(a);
  return len < EPSILON ? [0, 0, 0] : [a[0] / len, a[1] / len, a[2] / len];
}

export function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function clone(a: Vec3): Vec3 {
  return [a[0], a[1], a[2]];
}

export function equals(a: Vec3, b: Vec3, eps = EPSILON): boolean {
  return Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps && Math.abs(a[2] - b[2]) <= eps;
}
