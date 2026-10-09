// @vitest-environment jsdom
import { Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Scene, Vector3 } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PathEditor, PathEditorPanel, type PathEditorOptions } from '../src/three';

const created: PathEditor[] = [];
afterEach(() => {
  for (const editor of created.splice(0)) editor.dispose();
  document.body.innerHTML = '';
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(options: Partial<PathEditorOptions> = {}) {
  const scene = new Scene();
  const camera = new PerspectiveCamera(60, 2, 0.1, 1000);
  camera.position.set(0, 50, 50);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const domElement = document.createElement('canvas');
  Object.assign(domElement, { setPointerCapture: () => {}, releasePointerCapture: () => {} });
  document.body.appendChild(domElement);
  vi.spyOn(domElement, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 100));
  const editor = new PathEditor({ scene, camera, domElement, ...options });
  created.push(editor);
  return { scene, camera, domElement, editor };
}

describe('gizmo mode', () => {
  it('switches between moving and turning a point', () => {
    const { editor } = setup();
    const modes: string[] = [];
    editor.on('gizmomode', (mode) => modes.push(mode));
    editor.enable();
    expect(editor.gizmoMode).toBe('translate');
    editor.toggleGizmoMode();
    expect(editor.gizmoMode).toBe('rotate');
    editor.setGizmoMode('rotate');
    editor.setGizmoMode('translate');
    expect(modes).toEqual(['rotate', 'translate']);
  });

  it('survives a session reload', () => {
    const { editor } = setup();
    editor.enable();
    editor.setGizmoMode('rotate');
    expect(editor.saveSession('rig-test')).toBe(true);
    editor.setGizmoMode('translate');
    editor.restoreSession('rig-test');
    expect(editor.gizmoMode).toBe('rotate');
  });

  it('the panel writes yaw and time, and toggles the mode', () => {
    const { editor } = setup();
    editor.enable();
    const path = editor.createPath({ id: 'p', curve: 'linear', points: [[0, 0, 0], [10, 0, 0]] });
    editor.select('p', 1);
    const panel = new PathEditorPanel(editor);
    const set = (el: string, value: string) => {
      const input = panel.element.querySelector<HTMLInputElement>(`[data-el="${el}"]`)!;
      input.value = value;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('yaw', '-90');
    set('time', '1.5');
    expect(path.waypoints[1].yaw).toBe(-90);
    expect(path.waypoints[1].time).toBe(1.5);
    panel.element.querySelector<HTMLButtonElement>('[data-act="gizmomode"]')!.click();
    expect(editor.gizmoMode).toBe('rotate');
    panel.dispose();
  });
});

describe('waypointremoved', () => {
  it('reports the waypoint that is gone, in the same undo step', async () => {
    const { editor } = setup();
    editor.enable();
    const path = editor.createPath({
      id: 'p',
      curve: 'linear',
      points: [
        { position: [0, 0, 0], metadata: { name: 'start' } },
        { position: [10, 0, 0], metadata: { name: 'gate' } },
        { position: [20, 0, 0] },
      ],
    });
    await flush();
    const seen: { index: number; name: unknown }[] = [];
    // A host keeping named points alive: the name moves to the neighbour.
    editor.on('waypointremoved', ({ path: changed, index, waypoint }) => {
      seen.push({ index, name: waypoint.metadata.name });
      const heir = Math.min(index, changed.waypoints.length - 1);
      changed.setWaypointMetadata(heir, { ...changed.waypoints[heir].metadata, ...waypoint.metadata });
    });
    editor.removeWaypoint('p', 1);
    await flush();
    expect(seen).toEqual([{ index: 1, name: 'gate' }]);
    expect(path.waypoints).toHaveLength(2);
    expect(path.waypoints[1].metadata.name).toBe('gate');

    editor.undo();
    expect(path.waypoints).toHaveLength(3);
    expect(path.waypoints[1].metadata.name).toBe('gate');
    expect(path.waypoints[2].metadata.name).toBeUndefined();
  });

  it('stays quiet when canEdit refuses the delete', () => {
    const { editor } = setup({ canEdit: (action) => action !== 'deleteWaypoint' });
    editor.enable();
    editor.createPath({ id: 'p', curve: 'linear', points: [[0, 0, 0], [10, 0, 0]] });
    const removed = vi.fn();
    editor.on('waypointremoved', removed);
    editor.removeWaypoint('p', 0);
    expect(removed).not.toHaveBeenCalled();
  });
});

describe('markers in the editor', () => {
  it('are created in view, with one point and no curve edits', () => {
    const { editor } = setup();
    editor.enable();
    const marker = editor.createMarker({ id: 'spawn', yaw: 30 });
    expect(marker.isMarker).toBe(true);
    expect(marker.waypoints).toHaveLength(1);
    expect(marker.waypoints[0].yaw).toBe(30);
    expect(editor.markers).toEqual([marker]);
    expect(editor.routes).toEqual([]);
    expect(editor.can('addWaypoint', marker)).toBe(false);
    expect(editor.can('editCurve', marker)).toBe(false);
    expect(editor.can('moveWaypoint', marker, 0)).toBe(true);
    expect(editor.can('editWaypointProperties', marker, 0)).toBe(true);
  });

  it('refuse extra points and say so', () => {
    const { editor } = setup();
    editor.enable();
    const marker = editor.createMarker({ id: 'spawn', position: [0, 0, 0] });
    const denied = vi.fn();
    editor.on('denied', denied);
    expect(editor.addWaypoint()).toBe(null);
    expect(marker.waypoints).toHaveLength(1);
    expect(denied.mock.calls[0][0].action).toBe('addWaypoint');
  });

  it('export and import with the rest of the file', () => {
    const { editor } = setup();
    editor.enable();
    editor.createMarker({ id: 'spawn', position: [1, 2, 3], yaw: 90 });
    editor.createPath({ id: 'route', curve: 'linear', points: [[0, 0, 0], [5, 0, 0]] });
    const json = editor.exportString();
    const other = setup().editor;
    other.import(JSON.parse(json));
    expect(other.markers.map((m) => m.id)).toEqual(['spawn']);
    expect(other.routes.map((p) => p.id)).toEqual(['route']);
    expect(other.getPath('spawn')!.waypoints[0].yaw).toBe(90);
  });
});

describe('camera rigs', () => {
  const rigSetup = () => {
    const { editor, camera } = setup({ rigs: [{ path: 'cam', lookAt: 'aim', id: 'shot', duration: 2 }] });
    editor.enable();
    editor.createPath({ id: 'cam', curve: 'linear', points: [[0, 10, 0], [20, 10, 0]] });
    editor.createPath({ id: 'aim', curve: 'linear', points: [[0, 0, 40], [20, 0, 40]] });
    return { editor, camera, rig: editor.getRig('shot')! };
  };

  it('sample both paths at the same share of the way', () => {
    const { rig } = rigSetup();
    const position = new Vector3();
    const lookAt = new Vector3();
    expect(rig.sample(0.5, position, lookAt)).toBe(true);
    expect(position.toArray()).toEqual([10, 10, 0]);
    expect(lookAt.toArray()).toEqual([10, 0, 40]);
  });

  it('sample by authored time when both paths carry it', () => {
    const { editor, rig } = rigSetup();
    const cam = editor.getPath('cam')!;
    const aim = editor.getPath('aim')!;
    cam.setWaypointProperties(0, { time: 0 });
    cam.setWaypointProperties(1, { time: 4 });
    // The target lingers: its second half of the way takes three quarters of the time.
    aim.addWaypoint({ position: [5, 0, 40] }, 1);
    aim.setWaypointProperties(0, { time: 0 });
    aim.setWaypointProperties(1, { time: 1 });
    aim.setWaypointProperties(2, { time: 4 });
    expect(rig.timed).toBe(true);
    expect(rig.flightTime).toBe(4);
    const position = new Vector3();
    const lookAt = new Vector3();
    rig.sample(0.25, position, lookAt);
    expect(position.x).toBeCloseTo(5);
    expect(lookAt.x).toBeCloseTo(5);
  });

  it('draw a sight line per camera waypoint, and only when switched on', () => {
    const { editor, rig } = rigSetup();
    editor.update(0.016);
    const count = () => rig.lines.geometry.getAttribute('position')?.count ?? 0;
    expect(count()).toBe(4);
    expect(rig.group.visible).toBe(true);
    editor.setView({ sightlines: false });
    editor.update(0.016);
    expect(rig.group.visible).toBe(false);
  });

  it('fly the editor camera and put it back afterwards', () => {
    const { editor, camera, rig } = rigSetup();
    const before = camera.position.clone();
    const states: boolean[] = [];
    editor.on('rigstate', ({ playing }) => states.push(playing));

    expect(editor.playRig('shot')).toBe(true);
    expect(editor.flyingRig).toBe(rig);
    expect(camera.position.toArray()).toEqual([0, 10, 0]);
    const aim = new Vector3(0, 0, 1).applyQuaternion(camera.quaternion).negate();
    expect(aim.z).toBeGreaterThan(0.9);

    editor.update(1);
    expect(camera.position.x).toBeCloseTo(10);
    editor.update(1);
    expect(editor.flyingRig).toBe(null);
    expect(camera.position.distanceTo(before)).toBeLessThan(1e-6);
    expect(states).toEqual([true, false]);
  });

  it('stop on request and when the rig is removed', () => {
    const { editor, camera } = rigSetup();
    const before = camera.position.clone();
    editor.playRig('shot');
    editor.stopRig();
    expect(editor.flyingRig).toBe(null);
    expect(camera.position.distanceTo(before)).toBeLessThan(1e-6);
    editor.playRig('shot');
    editor.removeRig('shot');
    expect(editor.flyingRig).toBe(null);
    expect(editor.rigs).toHaveLength(0);
  });

  it('refuse a rig whose paths are missing', () => {
    const { editor } = setup({ rigs: [{ path: 'nope', lookAt: 'nothing', id: 'empty' }] });
    editor.enable();
    expect(editor.playRig('empty')).toBe(false);
    expect(editor.playRig('unknown')).toBe(false);
  });
});

describe('surface warnings', () => {
  const sagging = (linearHeight: boolean) => {
    const floor = new Mesh(new PlaneGeometry(500, 500).rotateX(-Math.PI / 2), new MeshBasicMaterial());
    floor.updateMatrixWorld();
    const { editor, scene } = setup({ surface: [floor] });
    scene.add(floor);
    editor.enable();
    editor.createPath({
      id: 'stairs',
      curve: { type: 'catmull-rom', parametrization: 'centripetal', linearHeight },
      points: [[0, 0, 0], [10, 0, 0], [14, 6, 0]],
    });
    editor.update(0.016);
    const geometry = editor.surfaceWarnings!.lines.geometry;
    return { editor, ticks: geometry.getAttribute('position')?.count ?? 0 };
  };

  it('tick the spans that run below the floor', () => {
    expect(sagging(false).ticks).toBeGreaterThan(0);
  });

  it('say nothing once the height is interpolated linearly', () => {
    expect(sagging(true).ticks).toBe(0);
  });

  it('can be switched off', () => {
    const { editor } = sagging(false);
    editor.setView({ surface: false });
    editor.update(0.016);
    expect(editor.surfaceWarnings!.group.visible).toBe(false);
  });

  it('are absent without a surface', () => {
    const { editor } = setup();
    expect(editor.surfaceWarnings).toBe(null);
  });
});
