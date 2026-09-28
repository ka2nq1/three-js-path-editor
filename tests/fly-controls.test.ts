// @vitest-environment jsdom
import { PerspectiveCamera, Scene } from 'three';
import { afterEach, describe, it } from 'vitest';
import { FlyControls, PathEditor } from '../src/three';
import { expectVecClose } from './helpers';

const disposables: { dispose(): void }[] = [];
afterEach(() => {
  for (const d of disposables.splice(0)) d.dispose();
});

function key(type: 'keydown' | 'keyup', code: string, init: KeyboardEventInit = {}) {
  window.dispatchEvent(new KeyboardEvent(type, { code, ...init }));
}

function fly(options: ConstructorParameters<typeof FlyControls>[1] = {}) {
  const camera = new PerspectiveCamera();
  const controls = new FlyControls(camera, options);
  disposables.push(controls);
  return { camera, controls };
}

describe('FlyControls', () => {
  it('moves along the view direction at `speed` units per second', () => {
    const { camera, controls } = fly({ speed: 10 });
    key('keydown', 'KeyW');
    controls.update(0.5);
    expectVecClose(camera.position.toArray(), [0, 0, -5]);
    key('keyup', 'KeyW');
    key('keydown', 'KeyE');
    controls.update(1);
    expectVecClose(camera.position.toArray(), [0, 10, -5]);
  });

  it('boosts, and ignores keys typed into inputs or pressed with Cmd/Ctrl', () => {
    const { camera, controls } = fly({ speed: 1, boostMultiplier: 3 });
    key('keydown', 'ShiftLeft');
    key('keydown', 'KeyD');
    controls.update(1);
    expectVecClose(camera.position.toArray(), [3, 0, 0]);
    key('keyup', 'KeyD');
    key('keyup', 'ShiftLeft');

    key('keydown', 'KeyS', { ctrlKey: true });
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
    controls.update(1);
    expectVecClose(camera.position.toArray(), [3, 0, 0]);
    input.remove();
  });

  it('keeps the current orientation when enabled and stops when disabled', () => {
    const camera = new PerspectiveCamera();
    camera.rotation.set(0, Math.PI / 2, 0, 'YXZ');
    const controls = new FlyControls(camera, { speed: 1 });
    disposables.push(controls);
    key('keydown', 'KeyW');
    controls.update(1);
    expectVecClose(camera.position.toArray(), [-1, 0, 0]);
    controls.enabled = false;
    controls.update(1);
    expectVecClose(camera.position.toArray(), [-1, 0, 0]);
    key('keyup', 'KeyW');
  });

  it('looks around while the look button is dragged', () => {
    const { camera, controls } = fly({ lookSensitivity: 1 });
    window.dispatchEvent(new MouseEvent('pointerdown', { button: 2 }));
    const move = new MouseEvent('pointermove');
    Object.defineProperty(move, 'movementX', { value: -90 });
    Object.defineProperty(move, 'movementY', { value: 0 });
    window.dispatchEvent(move);
    window.dispatchEvent(new MouseEvent('pointerup', { button: 2 }));
    controls.update(0);
    key('keydown', 'KeyW');
    controls.update(1);
    key('keyup', 'KeyW');
    expectVecClose(camera.position.toArray(), [-controls.speed, 0, 0]);
  });
});

describe('PathEditor restoreCameraOnDisable', () => {
  it('puts the camera back where it was when editing started', () => {
    const camera = new PerspectiveCamera();
    camera.position.set(1, 2, 3);
    const editor = new PathEditor({
      scene: new Scene(),
      camera,
      domElement: document.createElement('canvas'),
      restoreCameraOnDisable: true,
    });
    disposables.push(editor);
    editor.enable();
    camera.position.set(50, 50, 50);
    camera.rotation.set(0.3, 1, 0);
    editor.disable();
    expectVecClose(camera.position.toArray(), [1, 2, 3]);
    expectVecClose(camera.quaternion.toArray(), [0, 0, 0, 1]);
  });
});
