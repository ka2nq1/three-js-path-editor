// Three.js-independent core: path data, curve math, serialization, travel logic.
export * from './types';
export * from './Waypoint';
export * from './Path';
export * from './PathCursor';
export * from './ArcLengthTable';
export * from './coordinates';
export * from './serialization';
export * from './visuals';
export * from './curves';
export { Emitter, type Listener } from '../utils/Emitter';
export type { Vec3 } from '../utils/vec3';
/** Small Vec3 helpers used internally, exposed for convenience. */
export * as vecMath from '../utils/vec3';
