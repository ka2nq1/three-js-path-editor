// @vitest-environment jsdom
import { Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Scene, Vector3 } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { PathEditor, surfaceConstraint, type WaypointConstraint } from '../src/three';
import { expectVecClose } from './helpers';

const disposables: { dispose(): void }[] = [];
afterEach(() => {
  for (const d of disposables.splice(0)) d.dispose();
});

function ground(height: number, size = 100) {
  const mesh = new Mesh(new PlaneGeometry(size, size).rotateX(-Math.PI / 2), new MeshBasicMaterial());
  mesh.position.y = height;
  mesh.updateMatrixWorld();
  return mesh;
}

function setup(constrainWaypoint?: WaypointConstraint) {
  const editor = new PathEditor({
    scene: new Scene(),
    camera: new PerspectiveCamera(),
    domElement: document.createElement('canvas'),
    constrainWaypoint,
  });
  disposables.push(editor);
  const path = editor.createPath({ id: 'road', curve: 'linear', points: [[0, 7, 0], [10, 7, 0]] });
  return { editor, path };
}

describe('constrainWaypoint', () => {
  const flatten: WaypointConstraint = ({ position }) => position.setY(0);

  it('applies to moves, adds and inserts made through the editor', () => {
    const { editor, path } = setup(flatten);
    editor.moveWaypoint('road', 0, [0, 5, 3]);
    expect(path.waypoints[0].position).toEqual([0, 0, 3]);
    editor.select('road', 1);
    const added = editor.addWaypoint({ position: [20, 9, 0] })!;
    expect(path.waypoints[added].position).toEqual([20, 0, 0]);
    const inserted = editor.insertWaypointAt('road', 0.25)!;
    expect(path.waypoints[inserted].position[1]).toBe(0);
  });

  it('gets the path and index, and can leave a waypoint alone', () => {
    const seen: [string, number][] = [];
    const { editor, path } = setup(({ path, waypointIndex, position }) => {
      seen.push([path.id, waypointIndex]);
      return waypointIndex === 0 ? null : position.setY(1);
    });
    editor.moveWaypoint('road', 0, [0, 5, 0]);
    editor.moveWaypoint('road', 1, [10, 5, 0]);
    expect(seen).toEqual([['road', 0], ['road', 1]]);
    expect(path.waypoints.map((w) => w.position[1])).toEqual([5, 1]);
  });

  it('applyConstraints snaps existing waypoints, undoable as one step', async () => {
    const { editor, path } = setup();
    editor.history.clear();
    editor.constrainWaypoint = flatten;
    editor.applyConstraints();
    expect(path.waypoints.map((w) => w.position[1])).toEqual([0, 0]);
    await Promise.resolve();
    editor.undo();
    expect(path.waypoints.map((w) => w.position[1])).toEqual([7, 7]);
  });
});

describe('surfaceConstraint', () => {
  it('drops positions onto the highest surface below, with an offset', () => {
    const low = ground(2);
    const deck = ground(12, 10);
    const constraint = surfaceConstraint([low, deck], { offset: 0.5 });
    const path = setup().path;
    const drop = (x: number, y: number) => constraint({ path, waypointIndex: 0, position: new Vector3(x, y, 0) });
    expectVecClose(drop(30, 50)!.toArray(), [30, 2.5, 0]);
    expectVecClose(drop(0, -20)!.toArray(), [0, 12.5, 0]);
    expect(drop(500, 0)).toBeNull();
  });

  it('only touches paths passing the filter', () => {
    const constraint = surfaceConstraint([ground(0)], { filter: (p) => p.metadata.ground === true });
    const path = setup().path;
    expect(constraint({ path, waypointIndex: 0, position: new Vector3(0, 9, 0) })).toBeNull();
    path.metadata.ground = true;
    expectVecClose(constraint({ path, waypointIndex: 0, position: new Vector3(0, 9, 0) })!.toArray(), [0, 0, 0]);
  });
});
