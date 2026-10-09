// @vitest-environment jsdom
import { Group, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Scene, Vector3 } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EDITOR_VIEWPORT_ATTRIBUTE,
  PathEditor,
  PathEditorPanel,
  type PathEditorOptions,
} from '../src/three';

const created: PathEditor[] = [];
afterEach(() => {
  for (const editor of created.splice(0)) editor.dispose();
  document.body.innerHTML = '';
});

// jsdom has no pointer capture; TransformControls uses it on every press.
function canvas() {
  const domElement = document.createElement('canvas');
  Object.assign(domElement, { setPointerCapture: () => {}, releasePointerCapture: () => {} });
  document.body.appendChild(domElement);
  return domElement;
}

function setup(options: Partial<PathEditorOptions> = {}) {
  const scene = new Scene();
  const camera = new PerspectiveCamera(60, 2, 0.1, 1000);
  camera.position.set(0, 50, 50);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const domElement = canvas();
  vi.spyOn(domElement, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 100));
  Object.defineProperty(domElement, 'clientHeight', { value: 100 });
  const controls = { enabled: true, target: new Vector3() };
  const editor = new PathEditor({ scene, camera, domElement, cameraControls: controls, ...options });
  created.push(editor);
  return { scene, camera, domElement, editor, controls };
}

const press = (target: Element, x = 50, y = 50) =>
  target.dispatchEvent(new MouseEvent('pointerdown', { clientX: x, clientY: y, bubbles: true }));
const release = (target: Element, x = 50, y = 50) =>
  target.dispatchEvent(new MouseEvent('pointerup', { clientX: x, clientY: y, bubbles: true }));

describe('camera control suspension', () => {
  it('counts suspensions instead of restoring what it read', () => {
    const { editor, controls } = setup();
    editor.enable();
    const first = editor.suspendCameraControls();
    expect(controls.enabled).toBe(false);
    const second = editor.suspendCameraControls();
    first();
    expect(controls.enabled).toBe(false);
    second();
    expect(controls.enabled).toBe(true);
  });

  it('ignores a release called twice', () => {
    const { editor, controls } = setup();
    const release = editor.suspendCameraControls();
    release();
    const other = editor.suspendCameraControls();
    release();
    expect(controls.enabled).toBe(false);
    other();
    expect(controls.enabled).toBe(true);
  });

  it('gives back what the controls had before the first suspension', () => {
    const { editor, controls } = setup();
    controls.enabled = false;
    editor.suspendCameraControls()();
    expect(controls.enabled).toBe(false);
  });
});

describe('gizmo state', () => {
  it('ends a drag in progress before disabling, so the gizmo grabs presses again', () => {
    const { editor } = setup();
    editor.enable();
    const gizmo = editor.gizmo as { axis: string | null; dragging: boolean };
    gizmo.axis = 'X';
    gizmo.dragging = true;
    editor.disable();
    expect(gizmo.dragging).toBe(false);
    expect(gizmo.axis).toBe(null);
  });

  it('reports who owns the pointer', () => {
    const host = { axis: null as string | null };
    const { editor } = setup({ otherControls: [host] });
    editor.enable();
    expect(editor.gizmoEngaged).toBe(false);
    host.axis = 'Y';
    expect(editor.gizmoEngaged).toBe(true);
  });
});

describe('presses the host owns', () => {
  const selected = (options: Partial<PathEditorOptions>) => {
    const { editor, domElement } = setup(options);
    editor.enable();
    editor.createPath({ id: 'p', curve: 'linear', points: [[0, 0, 0], [10, 0, 0]] });
    editor.select('p', 1);
    editor.update(0.016);
    return { editor, domElement };
  };

  it('clears the selection on a click into empty space', () => {
    const { editor, domElement } = selected({});
    press(domElement, 180, 90);
    release(domElement, 180, 90);
    expect(editor.selection.waypointIndex).toBe(null);
  });

  it('keeps the selection while a host gizmo has an axis', () => {
    const host = { axis: 'Y' as string | null };
    const { editor, domElement } = selected({ otherControls: [host] });
    press(domElement, 180, 90);
    release(domElement, 180, 90);
    expect(editor.selection.waypointIndex).toBe(1);
  });

  it('keeps the selection when claimPointer takes the press', () => {
    const claimPointer = vi.fn(() => true);
    const { editor, domElement } = selected({ claimPointer });
    press(domElement, 180, 90);
    release(domElement, 180, 90);
    expect(claimPointer).toHaveBeenCalled();
    expect(editor.selection.waypointIndex).toBe(1);
  });

  it('ignores presses outside the viewport', () => {
    const claimPointer = vi.fn(() => false);
    const { domElement } = selected({ claimPointer });
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    press(outside, 10, 10);
    expect(claimPointer).not.toHaveBeenCalled();
    expect(domElement.isConnected).toBe(true);
  });
});

describe('isolateUi', () => {
  it('hides the host UI while editing and marks the viewport', () => {
    const { editor, domElement } = setup({ isolateUi: true });
    const html = document.documentElement;
    expect(html.className).toBe('');
    editor.enable();
    expect(html.className).toContain('path-editor-isolated-ui');
    expect(domElement.hasAttribute(EDITOR_VIEWPORT_ATTRIBUTE)).toBe(true);
    expect(document.getElementById('three-path-editor-isolation-style')).not.toBe(null);
    editor.disable();
    expect(html.className).not.toContain('path-editor-isolated-ui');
    expect(domElement.hasAttribute(EDITOR_VIEWPORT_ATTRIBUTE)).toBe(false);
  });

  it('marks the viewport even without isolation', () => {
    const { editor, domElement } = setup();
    editor.enable();
    expect(domElement.hasAttribute(EDITOR_VIEWPORT_ATTRIBUTE)).toBe(true);
    expect(document.documentElement.className).not.toContain('path-editor-isolated-ui');
  });
});

describe('detachCamera', () => {
  it('takes the camera out of its rig and puts it back', () => {
    const scene = new Scene();
    const rig = new Group();
    rig.position.set(10, 5, 0);
    rig.rotateY(Math.PI / 2);
    scene.add(rig);
    const camera = new PerspectiveCamera();
    camera.position.set(0, 0, -3);
    rig.add(camera);
    camera.updateMatrixWorld();
    const worldBefore = camera.getWorldPosition(new Vector3()).clone();
    const domElement = canvas();
    const editor = new PathEditor({ scene, camera, domElement, detachCamera: true });
    created.push(editor);

    editor.enable();
    expect(camera.parent).toBe(scene);
    expect(camera.getWorldPosition(new Vector3()).distanceTo(worldBefore)).toBeLessThan(1e-6);

    camera.position.set(100, 100, 100);
    editor.disable();
    expect(camera.parent).toBe(rig);
    expect(camera.position.toArray()).toEqual([0, 0, -3]);
    expect(camera.getWorldPosition(new Vector3()).distanceTo(worldBefore)).toBeLessThan(1e-6);
  });

  it('leaves a camera that already sits in the scene alone', () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    scene.add(camera);
    const domElement = canvas();
    const editor = new PathEditor({ scene, camera, domElement, detachCamera: true });
    created.push(editor);
    editor.enable();
    expect(camera.parent).toBe(scene);
    editor.disable();
    expect(camera.parent).toBe(scene);
  });
});

describe('pivotUnderPointer', () => {
  const floor = () => {
    const mesh = new Mesh(new PlaneGeometry(500, 500).rotateX(-Math.PI / 2), new MeshBasicMaterial());
    mesh.updateMatrixWorld();
    return mesh;
  };

  it('moves the pivot onto the surface under the pointer', () => {
    const { editor, scene, camera, domElement, controls } = setup({ pivotUnderPointer: true });
    scene.add(floor());
    controls.target.set(0, 0, 0);
    editor.enable();
    press(domElement, 100, 50);
    expect(controls.target.length()).toBeLessThan(0.5);

    // Pressing above the centre looks further across the floor: the pivot takes
    // that depth, but stays on the view axis so the view cannot jump.
    press(domElement, 100, 20);
    const axis = camera.getWorldDirection(new Vector3());
    const toTarget = controls.target.clone().sub(camera.position);
    expect(toTarget.clone().normalize().dot(axis)).toBeCloseTo(1, 6);
    expect(toTarget.length()).toBeGreaterThan(camera.position.length());
  });

  it('follows the wheel too', () => {
    const { editor, scene, domElement, controls } = setup({ pivotUnderPointer: true });
    scene.add(floor());
    editor.enable();
    controls.target.set(99, 99, 99);
    domElement.dispatchEvent(new WheelEvent('wheel', { clientX: 100, clientY: 50, bubbles: true }));
    expect(controls.target.length()).toBeLessThan(0.5);
  });

  it('keeps a minimum distance from the camera', () => {
    const { editor, scene, camera, domElement, controls } = setup({ pivotUnderPointer: { minDistance: 200 } });
    scene.add(floor());
    editor.enable();
    press(domElement, 100, 50);
    expect(camera.position.distanceTo(controls.target)).toBeCloseTo(200, 3);
  });

  it('ignores its own objects and presses outside the viewport', () => {
    const { editor, controls } = setup({ pivotUnderPointer: true });
    editor.enable();
    editor.createPath({ id: 'p', curve: 'linear', points: [[0, 0, 0], [10, 0, 0]] });
    editor.update(0.016);
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    controls.target.set(0, 0, 0);
    press(outside, 10, 10);
    expect(controls.target.toArray()).toEqual([0, 0, 0]);
  });

  it('does nothing without controls that have a target', () => {
    const scene = new Scene();
    const domElement = canvas();
    const controls = { enabled: true };
    const editor = new PathEditor({
      scene,
      camera: new PerspectiveCamera(),
      domElement,
      cameraControls: controls,
      pivotUnderPointer: true,
    });
    created.push(editor);
    editor.enable();
    expect(() => press(domElement, 50, 50)).not.toThrow();
  });
});

describe('panel visibility', () => {
  it('hides itself while the editor is disabled when asked', () => {
    const { editor } = setup();
    const panel = new PathEditorPanel(editor, { hideWhenDisabled: true });
    expect(panel.element.style.display).toBe('none');
    editor.enable();
    expect(panel.element.style.display).toBe('');
    editor.disable();
    expect(panel.element.style.display).toBe('none');
    panel.dispose();
  });

  it('stays put by default, since its own button toggles the editor', () => {
    const { editor } = setup();
    const panel = new PathEditorPanel(editor);
    editor.enable();
    editor.disable();
    expect(panel.element.style.display).toBe('');
    panel.dispose();
  });
});
