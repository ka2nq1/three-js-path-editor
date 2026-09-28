import { Path } from './Path';
import { structuredCloneSafe } from './Waypoint';
import type { PathData, PathFileData } from './types';

export const PATH_FORMAT_VERSION = 1;

export class PathFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathFormatError';
  }
}

export interface PathFile {
  version: number;
  paths: Path[];
  /** Unknown top-level keys, preserved by `serializePaths(paths, file.extras)`. */
  extras: Record<string, unknown>;
}

/** Serializes paths into the versioned JSON format. */
export function serializePaths(paths: Iterable<Path>, extras: Record<string, unknown> = {}): PathFileData {
  return {
    ...structuredCloneSafe(extras),
    version: PATH_FORMAT_VERSION,
    paths: [...paths].map((p) => p.toJSON()),
  };
}

export function stringifyPaths(paths: Iterable<Path>, indent = 2, extras?: Record<string, unknown>): string {
  return JSON.stringify(serializePaths(paths, extras), null, indent);
}

/**
 * Parses a path file (object or JSON string). Also accepts a single path object
 * or a bare array of paths. Throws `PathFormatError` on invalid input.
 */
export function readPathFile(input: unknown): PathFile {
  let raw = input;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch (err) {
      throw new PathFormatError(`Invalid JSON: ${(err as Error).message}`);
    }
  }
  if (Array.isArray(raw)) raw = { version: PATH_FORMAT_VERSION, paths: raw };
  if (!isObject(raw)) throw new PathFormatError('Path file must be an object.');
  if (!('paths' in raw) && 'points' in raw) raw = { version: PATH_FORMAT_VERSION, paths: [raw] };

  const file = migrate(raw as Record<string, unknown>);
  const { version, paths, ...extras } = file;
  if (!Array.isArray(paths)) throw new PathFormatError('"paths" must be an array.');

  const seen = new Set<string>();
  const parsed = paths.map((p, i) => {
    validatePathData(p, `paths[${i}]`);
    if (seen.has(p.id)) throw new PathFormatError(`Duplicate path id "${p.id}".`);
    seen.add(p.id);
    return Path.fromJSON(p);
  });
  return { version: version as number, paths: parsed, extras };
}

/** Convenience: returns just the paths of a path file. */
export function parsePathFile(input: unknown): Path[] {
  return readPathFile(input).paths;
}

/** Convenience: parses a file and returns the path with the given id (throws if missing). */
export function getPathFromFile(input: unknown, id: string): Path {
  const path = parsePathFile(input).find((p) => p.id === id);
  if (!path) throw new PathFormatError(`Path "${id}" not found.`);
  return path;
}

/** Upgrades older file versions to the current one. Add steps here when the format changes. */
function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  const version = raw.version === undefined ? PATH_FORMAT_VERSION : raw.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new PathFormatError(`Invalid version: ${String(raw.version)}`);
  }
  if (version > PATH_FORMAT_VERSION) {
    throw new PathFormatError(
      `Path file version ${version} is newer than supported version ${PATH_FORMAT_VERSION}. Update three-path-editor.`,
    );
  }
  return { ...raw, version: PATH_FORMAT_VERSION };
}

function validatePathData(p: unknown, where: string): asserts p is PathData {
  if (!isObject(p)) throw new PathFormatError(`${where} must be an object.`);
  if (typeof p.id !== 'string' || !p.id) throw new PathFormatError(`${where}.id must be a non-empty string.`);
  if (p.dimension !== 2 && p.dimension !== 3) throw new PathFormatError(`${where}.dimension must be 2 or 3.`);
  if (p.curve !== undefined) {
    if (!isObject(p.curve)) throw new PathFormatError(`${where}.curve must be an object.`);
    const type = p.curve.type;
    if (type !== 'linear' && type !== 'catmull-rom' && type !== 'bezier') {
      throw new PathFormatError(`${where}.curve.type must be "linear", "catmull-rom" or "bezier".`);
    }
    const parametrization = p.curve.parametrization;
    if (parametrization !== undefined && parametrization !== 'uniform' && parametrization !== 'centripetal' && parametrization !== 'chordal') {
      throw new PathFormatError(`${where}.curve.parametrization must be "uniform", "centripetal" or "chordal".`);
    }
  }
  if (!Array.isArray(p.points)) throw new PathFormatError(`${where}.points must be an array.`);
  p.points.forEach((pt, j) => {
    const at = `${where}.points[${j}]`;
    if (!isObject(pt)) throw new PathFormatError(`${at} must be an object.`);
    for (const key of ['position', 'handleIn', 'handleOut'] as const) {
      const v = pt[key];
      if (key !== 'position' && v === undefined) continue;
      if (!Array.isArray(v) || v.length < 2 || v.length > 3 || !v.every((n) => typeof n === 'number' && Number.isFinite(n))) {
        throw new PathFormatError(`${at}.${key} must be an array of 2 or 3 finite numbers.`);
      }
    }
    for (const key of ['speed', 'roll'] as const) {
      const v = pt[key];
      if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v))) {
        throw new PathFormatError(`${at}.${key} must be a finite number.`);
      }
    }
    if (pt.metadata !== undefined && !isObject(pt.metadata)) throw new PathFormatError(`${at}.metadata must be an object.`);
  });
  if (p.metadata !== undefined && !isObject(p.metadata)) throw new PathFormatError(`${where}.metadata must be an object.`);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
