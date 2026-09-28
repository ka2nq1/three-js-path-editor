import type { Vec3 } from '../src/core';

export function expectVecClose(actual: ArrayLike<number>, expected: ArrayLike<number>, digits = 5): void {
  for (let i = 0; i < expected.length; i++) {
    if (Math.abs(actual[i] - expected[i]) > 10 ** -digits) {
      throw new Error(`Expected [${Array.from(expected)}] but got [${Array.from(actual)}]`);
    }
  }
}

export const square: Vec3[] = [
  [0, 0, 0],
  [10, 0, 0],
  [10, 0, 10],
  [0, 0, 10],
];
