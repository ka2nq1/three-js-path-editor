export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Positive modulo: wraps `value` into [0, max). */
export function wrap(value: number, max: number): number {
  return ((value % max) + max) % max;
}
