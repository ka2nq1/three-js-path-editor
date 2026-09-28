import { Euler, MathUtils, Vector3, type Camera } from 'three';

export interface FlyKeyMap {
  forward: string[];
  back: string[];
  left: string[];
  right: string[];
  up: string[];
  down: string[];
  lookLeft: string[];
  lookRight: string[];
  lookUp: string[];
  lookDown: string[];
  boost: string[];
}

export interface FlyControlsOptions {
  /** Element that receives the look drag and wheel. Default `window`. */
  domElement?: HTMLElement | Window;
  /** World units per second. Adjust with the mouse wheel at runtime. Default 10. */
  speed?: number;
  /** Speed multiplier while a `boost` key is held. Default 4. */
  boostMultiplier?: number;
  /** Degrees of rotation per dragged pixel. Default 0.2. */
  lookSensitivity?: number;
  /** Degrees per second for the keyboard look keys. Default 90. */
  keyLookSpeed?: number;
  /** Mouse button that drags the view: 0 left, 1 middle, 2 right. Default 2 (left stays free for picking). */
  lookButton?: 0 | 1 | 2;
  /** Wheel speed step factor; 0 disables wheel speed changes. Default 1.2. */
  wheelSpeedFactor?: number;
  /** Override key bindings (KeyboardEvent.code values). */
  keys?: Partial<FlyKeyMap>;
  /** Start enabled. Default true. */
  enabled?: boolean;
}

export const DEFAULT_FLY_KEYS: FlyKeyMap = {
  forward: ['KeyW'],
  back: ['KeyS'],
  left: ['KeyA'],
  right: ['KeyD'],
  up: ['KeyE', 'Space'],
  down: ['KeyQ', 'KeyC'],
  lookLeft: ['ArrowLeft'],
  lookRight: ['ArrowRight'],
  lookUp: ['ArrowUp'],
  lookDown: ['ArrowDown'],
  boost: ['ShiftLeft', 'ShiftRight'],
};

const PITCH_LIMIT_DEG = 89;
const _forward = new Vector3();
const _right = new Vector3();
const _move = new Vector3();
const _euler = new Euler(0, 0, 0, 'YXZ');

/**
 * Minimal free-fly camera for editing: WASD to move, E/Q (Space/C) up/down,
 * right-drag or arrow keys to look, wheel to change speed, Shift to boost.
 *
 * Framework-agnostic and optional: it moves the camera you pass and nothing
 * else, has no loop of its own (call `update(dt)` from yours), and ignores
 * keys typed into inputs or pressed with Cmd/Ctrl. It has an `enabled` flag,
 * so it can be passed to `PathEditor` as `cameraControls` (look dragging then
 * pauses while a gizmo is dragged).
 *
 * The camera is moved in its parent's space; attach it to the scene (or an
 * untransformed parent) while flying.
 */
export class FlyControls {
  readonly camera: Camera;
  speed: number;
  boostMultiplier: number;
  lookSensitivity: number;
  keyLookSpeed: number;
  lookButton: 0 | 1 | 2;
  wheelSpeedFactor: number;
  readonly keys: FlyKeyMap;

  private readonly domElement: HTMLElement | Window;
  private readonly pressed = new Set<string>();
  private _enabled = false;
  private looking = false;
  private yawDeg = 0;
  private pitchDeg = 0;
  private disposed = false;

  constructor(camera: Camera, options: FlyControlsOptions = {}) {
    this.camera = camera;
    this.domElement = options.domElement ?? window;
    this.speed = options.speed ?? 10;
    this.boostMultiplier = options.boostMultiplier ?? 4;
    this.lookSensitivity = options.lookSensitivity ?? 0.2;
    this.keyLookSpeed = options.keyLookSpeed ?? 90;
    this.lookButton = options.lookButton ?? 2;
    this.wheelSpeedFactor = options.wheelSpeedFactor ?? 1.2;
    this.keys = { ...DEFAULT_FLY_KEYS, ...options.keys };
    this.enabled = options.enabled ?? true;
  }

  get enabled(): boolean {
    return this._enabled;
  }

  /** Enabling re-reads the camera's current orientation, so it never snaps. */
  set enabled(value: boolean) {
    if (this.disposed || value === this._enabled) return;
    this._enabled = value;
    if (value) {
      this.syncFromCamera();
      this.attach();
    } else {
      this.detach();
    }
  }

  /** Re-reads yaw/pitch from the camera (call after moving the camera yourself). */
  syncFromCamera(): void {
    _euler.setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.yawDeg = MathUtils.radToDeg(_euler.y);
    this.pitchDeg = MathUtils.clamp(MathUtils.radToDeg(_euler.x), -PITCH_LIMIT_DEG, PITCH_LIMIT_DEG);
  }

  /** Moves and turns the camera. Call once per frame while enabled. */
  update(dt: number): void {
    if (!this._enabled) return;
    const look = this.keyLookSpeed * dt;
    if (this.isDown('lookLeft')) this.yawDeg += look;
    if (this.isDown('lookRight')) this.yawDeg -= look;
    if (this.isDown('lookUp')) this.pitchDeg += look;
    if (this.isDown('lookDown')) this.pitchDeg -= look;
    this.pitchDeg = MathUtils.clamp(this.pitchDeg, -PITCH_LIMIT_DEG, PITCH_LIMIT_DEG);
    _euler.set(MathUtils.degToRad(this.pitchDeg), MathUtils.degToRad(this.yawDeg), 0, 'YXZ');
    this.camera.quaternion.setFromEuler(_euler);

    const yaw = MathUtils.degToRad(this.yawDeg);
    _forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    _right.set(-_forward.z, 0, _forward.x);
    _move.set(0, 0, 0);
    if (this.isDown('forward')) _move.add(_forward);
    if (this.isDown('back')) _move.sub(_forward);
    if (this.isDown('right')) _move.add(_right);
    if (this.isDown('left')) _move.sub(_right);
    if (this.isDown('up')) _move.y += 1;
    if (this.isDown('down')) _move.y -= 1;
    if (_move.lengthSq() === 0) return;
    const speed = this.speed * (this.isDown('boost') ? this.boostMultiplier : 1);
    this.camera.position.addScaledVector(_move.normalize(), speed * dt);
  }

  dispose(): void {
    this.enabled = false;
    this.disposed = true;
  }

  private isDown(action: keyof FlyKeyMap): boolean {
    return this.keys[action].some((code) => this.pressed.has(code));
  }

  private attach(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    this.domElement.addEventListener('pointerdown', this.onPointerDown as EventListener);
    this.domElement.addEventListener('contextmenu', this.onContextMenu);
    this.domElement.addEventListener('wheel', this.onWheel as EventListener, { passive: true });
  }

  private detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.domElement.removeEventListener('pointerdown', this.onPointerDown as EventListener);
    this.domElement.removeEventListener('contextmenu', this.onContextMenu);
    this.domElement.removeEventListener('wheel', this.onWheel as EventListener);
    this.pressed.clear();
    this.looking = false;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
    this.pressed.add(e.code);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.pressed.delete(e.code);
  };

  private readonly onBlur = (): void => {
    this.pressed.clear();
    this.looking = false;
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button === this.lookButton) this.looking = true;
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.looking) return;
    this.yawDeg -= e.movementX * this.lookSensitivity;
    this.pitchDeg = MathUtils.clamp(this.pitchDeg - e.movementY * this.lookSensitivity, -PITCH_LIMIT_DEG, PITCH_LIMIT_DEG);
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.button === this.lookButton) this.looking = false;
  };

  private readonly onContextMenu = (e: Event): void => {
    if (this.lookButton === 2) e.preventDefault();
  };

  private readonly onWheel = (e: WheelEvent): void => {
    if (!this.wheelSpeedFactor || e.deltaY === 0) return;
    this.speed *= e.deltaY < 0 ? this.wheelSpeedFactor : 1 / this.wheelSpeedFactor;
  };
}

function isTyping(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}
