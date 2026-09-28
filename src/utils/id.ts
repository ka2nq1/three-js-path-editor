let counter = 0;

/** Generates a short id that is unique within the current session. */
export function createId(prefix = 'path'): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}
