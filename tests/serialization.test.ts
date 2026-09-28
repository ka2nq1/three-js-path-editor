import { describe, expect, it } from 'vitest';
import {
  PATH_FORMAT_VERSION,
  Path,
  PathFormatError,
  getPathFromFile,
  parsePathFile,
  readPathFile,
  serializePaths,
  stringifyPaths,
} from '../src/core';

const example = {
  version: 1,
  paths: [
    {
      id: 'helicopter-route',
      dimension: 3,
      curve: { type: 'catmull-rom', closed: false, tension: 0.5 },
      points: [{ position: [0, 20, 0] }, { position: [30, 30, -50] }, { position: [80, 50, -100] }],
      metadata: {},
    },
  ],
};

describe('serialization', () => {
  it('parses the documented example format', () => {
    const [path] = parsePathFile(example);
    expect(path.id).toBe('helicopter-route');
    expect(path.dimension).toBe(3);
    expect(path.waypoints).toHaveLength(3);
    expect(path.waypoints[2].position).toEqual([80, 50, -100]);
  });

  it('round-trips exactly', () => {
    const out = serializePaths(parsePathFile(example));
    expect(out).toEqual(example);
    expect(JSON.parse(stringifyPaths(parsePathFile(JSON.stringify(example))))).toEqual(example);
  });

  it('writes 2D positions with two components', () => {
    const path = new Path({ id: 'p', dimension: 2, points: [[1, 2], [3, 4]], curve: 'linear' });
    const data = serializePaths([path]);
    expect(data.version).toBe(PATH_FORMAT_VERSION);
    expect(data.paths[0].points).toEqual([{ position: [1, 2] }, { position: [3, 4] }]);
    const [back] = parsePathFile(data);
    expect(back.dimension).toBe(2);
    expect(back.waypoints[1].position).toEqual([3, 4, 0]);
  });

  it('preserves metadata and unknown fields on paths, waypoints and the file', () => {
    const input = {
      version: 1,
      author: 'level-designer',
      editor: { camera: [1, 2, 3] },
      paths: [
        {
          id: 'r',
          name: 'Route',
          dimension: 3,
          curve: { type: 'bezier', closed: true, tension: 0.3 },
          points: [
            { id: 'a', position: [0, 0, 0], handleOut: [1, 0, 0], metadata: { wait: 2, tags: ['start'] }, customFlag: true },
            { position: [5, 0, 0], metadata: { speed: { mul: 0.5 } } },
          ],
          metadata: { team: 'red', nested: { deep: [1, { x: null }] } },
          layer: 'air',
        },
      ],
    };
    const file = readPathFile(input);
    expect(file.extras).toEqual({ author: 'level-designer', editor: { camera: [1, 2, 3] } });
    const [path] = file.paths;
    expect(path.metadata).toEqual(input.paths[0].metadata);
    expect(path.waypoints[0].metadata).toEqual({ wait: 2, tags: ['start'] });
    expect(serializePaths(file.paths, file.extras)).toEqual(input);
  });

  it('does not share metadata objects with the input', () => {
    const input = structuredClone(example);
    (input.paths[0].metadata as Record<string, unknown>).x = { y: 1 };
    const [path] = parsePathFile(input);
    ((input.paths[0].metadata as Record<string, unknown>).x as { y: number }).y = 2;
    expect((path.metadata.x as { y: number }).y).toBe(1);
  });

  it('accepts a single path object or an array of paths', () => {
    expect(parsePathFile(example.paths[0])).toHaveLength(1);
    expect(parsePathFile(example.paths)).toHaveLength(1);
  });

  it('finds a path by id', () => {
    expect(getPathFromFile(example, 'helicopter-route').id).toBe('helicopter-route');
    expect(() => getPathFromFile(example, 'missing')).toThrow(PathFormatError);
  });

  it.each([
    ['invalid json', '{nope'],
    ['non-object', 42],
    ['future version', { version: 99, paths: [] }],
    ['bad dimension', { version: 1, paths: [{ id: 'a', dimension: 4, curve: { type: 'linear' }, points: [] }] }],
    ['bad curve', { version: 1, paths: [{ id: 'a', dimension: 3, curve: { type: 'nurbs' }, points: [] }] }],
    ['bad position', { version: 1, paths: [{ id: 'a', dimension: 3, curve: { type: 'linear' }, points: [{ position: [1] }] }] }],
    ['NaN position', { version: 1, paths: [{ id: 'a', dimension: 3, points: [{ position: [1, NaN, 0] }] }] }],
    ['duplicate id', { version: 1, paths: [{ id: 'a', dimension: 3, points: [] }, { id: 'a', dimension: 3, points: [] }] }],
    ['missing id', { version: 1, paths: [{ dimension: 3, points: [] }] }],
  ])('rejects %s', (_, input) => {
    expect(() => readPathFile(input)).toThrow(PathFormatError);
  });

  it('defaults a missing curve and missing version', () => {
    const [path] = parsePathFile({ paths: [{ id: 'a', dimension: 3, points: [{ position: [0, 0, 0] }] }] });
    expect(path.curve.type).toBe('catmull-rom');
  });
});
