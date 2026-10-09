import {
  AxesHelper,
  ConeGeometry,
  GridHelper,
  Group,
  LineBasicMaterial,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Plane,
  Quaternion,
  Raycaster,
  Vector2,
  Vector3,
  type Camera,
  type Intersection,
} from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import {
  createCoordinateSystem,
  type CoordinateSystem,
  type CoordinateSystemOptions,
} from '../core/coordinates';
import { Path, type PathOptions } from '../core/Path';
import type { Waypoint } from '../core/Waypoint';
import { readPathFile, serializePaths, stringifyPaths } from '../core/serialization';
import type { PathData, PathDimension, PathFileData } from '../core/types';
import {
  EditorState,
  type EditorSelection,
  type EditorViewOptions,
  type HandleKind,
} from '../editor/EditorState';
import { EditorHistory } from '../editor/EditorHistory';
import { averageSpacing, insertWaypointAfter, insertWaypointAtT, shiftWaypoint } from '../editor/operations';
import { bindShortcuts } from '../editor/shortcuts';
import { Emitter, type Listener } from '../utils/Emitter';
import { add, length as vecLength, normalize, scale, sub, toVec3 } from '../utils/vec3';
import { Orienter } from '../runtime/orientation';
import { isEditorObject, pathUp, planePlacement, type PlacementProvider, type WaypointConstraint } from './placement';
import { CameraRig, type CameraRigOptions } from './CameraRig';
import { SurfaceCheck, type SurfaceCheckOptions } from './SurfaceCheck';
import { PathPreview, type PathPreviewOptions } from './PathPreview';
import { worldUnitsPerPixel } from './screen';
import { ThreePathRenderer, type PathPickData, type ThreePathRendererOptions } from './ThreePathRenderer';

export interface PathEditorOptions {
  /** The application's existing scene (or any Object3D to parent the editor root to). */
  scene: Object3D;
  /** The application's active camera. Update with `setCamera()` if it changes. */
  camera: Camera;
  /** The application's renderer; only `domElement` is used. */
  renderer?: { domElement: HTMLElement };
  /** Element that receives pointer input. Defaults to `renderer.domElement`. */
  domElement?: HTMLElement;
  /** Path space <-> world mapping. Default: Y-up, 2D paths on the XZ plane. */
  coordinates?: CoordinateSystem | CoordinateSystemOptions;
  /** Initial view toggles. */
  view?: Partial<EditorViewOptions>;
  /** Rendering options applied to every path (style, arrow spacing...). */
  render?: Omit<ThreePathRendererOptions, 'coordinates'>;
  /** Editor grid helper. Default size 100, 20 divisions. */
  grid?: { size?: number; divisions?: number; color?: number; centerColor?: number };
  /**
   * Your camera controls (OrbitControls, MapControls...). The editor suspends
   * them while a gizmo is dragged and releases them afterwards. Host gizmos
   * must go through `suspendCameraControls()` rather than writing `enabled`
   * themselves, so two overlapping drags can't leave the camera switched off.
   */
  cameraControls?: CameraControlsLike | null;
  /**
   * Other gizmos or controls in the scene that may own a pointer press (a host
   * `TransformControls`). While one of them reports an `axis`, the editor
   * leaves the press alone: it neither selects nor clears the selection, so
   * clicking a host gizmo no longer deselects the waypoint it belongs to.
   */
  otherControls?: GizmoLike[];
  /**
   * Called first for every pointer press in the viewport. Return true to tell
   * the editor the press belongs to the host (its own gizmo, a 3D widget): the
   * editor ignores it completely and lets it through.
   */
  claimPointer?: (event: PointerEvent) => boolean;
  /**
   * Keeps the camera controls' pivot (`target`) on the surface under the
   * pointer, on the view axis so the view never jumps. Bare `OrbitControls`
   * scale zoom and pan by the distance to `target`, so both stall near a fixed
   * pivot. Needs controls with a `target` vector. Default false.
   */
  pivotUnderPointer?: boolean | PivotOptions;
  /**
   * While the editor is enabled, hide and block every element on the page
   * except the viewport and elements marked `data-path-editor-ui`, so the
   * game's own UI cannot cover the canvas or swallow presses. Uses
   * `visibility`, so layouts keep their size. Default false.
   */
  isolateUi?: boolean;
  /**
   * Move the camera out of its rig into the scene for the editing session and
   * put it back on `disable()`. Camera controls cannot orbit a camera that a
   * rig drives, so hosts otherwise have to detach it themselves. Implies
   * `restoreCameraOnDisable`. Default false.
   */
  detachCamera?: boolean;
  /** Where Shift+click places new waypoints. Default: `planePlacement()`. */
  placement?: PlacementProvider;
  /**
   * Camera paths paired with what they look at. The editor draws sight lines
   * between the matching points and can fly its own camera along a rig
   * (`playRig`). See `CameraRig`.
   */
  rigs?: CameraRigOptions[];
  /**
   * Floors or terrain the paths are authored on. Spans of a curve that run
   * below them get a warning tick in the view (toggle `surface`), which is how
   * a spline sagging under a floor between two points becomes visible — see
   * `curve.linearHeight`.
   */
  surface?: SurfaceCheckOptions['objects'] | SurfaceCheckOptions;
  /** Enable keyboard shortcuts (see editor/shortcuts). Default true. */
  keyboardShortcuts?: boolean;
  /**
   * What the gizmo does: 'translate' (default) moves the selected waypoint,
   * 'rotate' authors its `yaw` — the facing of whatever stands on it. Toggled
   * with R, or `setGizmoMode()`.
   */
  gizmoMode?: GizmoMode;
  /** Keep Bezier handles of a waypoint collinear while dragging one. Default true. */
  mirrorBezierHandles?: boolean;
  /** Enable immediately. Default false: call `enable()`. */
  enabled?: boolean;
  /** Maximum undo steps. Default 100. */
  historyLimit?: number;
  /**
   * Warn once (console) when a pointer press inside `domElement`'s area lands
   * on another element, i.e. something covers the canvas and the editor never
   * sees the click. The `inputblocked` event fires either way. Default true.
   */
  diagnostics?: boolean;
  /**
   * Remember the camera's position/rotation on `enable()` and put it back on
   * `disable()`, so flying around while editing doesn't leave the game camera
   * somewhere else. Default false.
   */
  restoreCameraOnDisable?: boolean;
  /**
   * Decides which edits the editor (UI, shortcuts and its own methods) may
   * make, e.g. to protect waypoints your code looks up by name, or to keep a
   * path's curve type fixed. Return false to refuse; the editor then emits
   * `denied`. Direct `Path` method calls are not checked. Default: allow all.
   */
  canEdit?: (action: EditorAction, context: EditActionContext) => boolean;
  /**
   * Adjusts every waypoint position the editor places or moves (gizmo drag,
   * Shift+click, insert, typed coordinates), e.g. `surfaceConstraint(...)` to
   * keep ground routes on the terrain. Bezier handles are not constrained.
   */
  constrainWaypoint?: WaypointConstraint;
}

/** What the editor's gizmo edits: the waypoint's position or its `yaw`. */
export type GizmoMode = 'translate' | 'rotate';

/** The part of camera controls the editor uses (OrbitControls and friends). */
export interface CameraControlsLike {
  enabled: boolean;
  /** Orbit pivot, used by `pivotUnderPointer`. */
  target?: Vector3;
}

/** The part of a `TransformControls` the editor reads to see who owns a press. */
export interface GizmoLike {
  /** The axis under the pointer, or being dragged; null when the gizmo is idle. */
  axis: string | null;
  /** True while a drag is in progress (`TransformControls` has it). */
  dragging?: boolean;
}

export interface PivotOptions {
  /**
   * Objects the pivot ray tests. Default: everything in the scene except the
   * editor's own objects.
   */
  objects?: Object3D[] | (() => Object3D[]);
  /**
   * Minimum distance kept between the camera and the pivot, so the wheel and
   * pan keep usable steps right at a surface. Default 1.
   */
  minDistance?: number;
}

export type EditorAction =
  | 'addWaypoint'
  | 'deleteWaypoint'
  | 'moveWaypoint'
  | 'reorderWaypoint'
  | 'editWaypointProperties'
  | 'deletePath'
  | 'renamePath'
  | 'editCurve'
  | 'editMetadata';

export interface EditActionContext {
  path: Path;
  /** The waypoint the action targets, or null for path-level actions. */
  waypointIndex: number | null;
}

export interface PathEditorEvents {
  /** A path's geometry or settings changed. */
  change: { path: Path };
  select: EditorSelection;
  view: EditorViewOptions;
  pathadded: { path: Path };
  pathremoved: { path: Path };
  import: { paths: Path[] };
  /**
   * A waypoint was deleted through the editor (UI, shortcut or API), with the
   * waypoint that is gone and the index it sat at. Fires in the same task as
   * the deletion, so edits made in the handler join its undo step.
   */
  waypointremoved: { path: Path; index: number; waypoint: Waypoint };
  /** The gizmo switched between moving a waypoint and turning it. */
  gizmomode: GizmoMode;
  /** A camera rig flight started or stopped (`playRig` / `stopRig`, or the end of the flight). */
  rigstate: { rig: CameraRig; playing: boolean };
  dragstart: { path: Path; waypointIndex: number };
  dragend: { path: Path; waypointIndex: number };
  enabled: boolean;
  /** A preview was attached (or retargeted by `previewPath`), or detached (`null`). */
  preview: PathPreview | null;
  /**
   * The current preview started or stopped playing: panel buttons, API calls,
   * the end of a non-looping path. Also fires after `preview` when an attached
   * preview starts playing, and with `playing: false` when a playing preview is detached.
   */
  previewstate: { preview: PathPreview; playing: boolean };
  /** Undo/redo availability changed. */
  history: { canUndo: boolean; canRedo: boolean };
  /**
   * A pointer press inside `domElement`'s area was received by another element
   * (an overlay covering the canvas), so the editor could not handle it.
   */
  inputblocked: { target: Element; event: PointerEvent };
  /** `canEdit` refused an edit. */
  denied: { action: EditorAction } & EditActionContext;
}

export interface PickResult {
  kind: 'waypoint' | 'handle' | 'line';
  path: Path;
  waypointIndex: number | null;
  handle: HandleKind | null;
  point: Vector3;
  /** For line hits: curve parameter t of the closest point on the curve. */
  t: number | null;
}

/** What `saveSession()` stores so editing can resume after a page reload. */
export interface EditorSessionState {
  version: 1;
  enabled: boolean;
  selection: EditorSelection;
  view: EditorViewOptions;
  camera: { position: number[]; quaternion: number[] };
  gizmoMode?: GizmoMode;
}

export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface RestoreSessionOptions {
  /** Also restore the camera pose. Default true. */
  camera?: boolean;
  /** Keep the stored state instead of consuming it. Default false. */
  keep?: boolean;
  /** Default `sessionStorage`. */
  storage?: SessionStorageLike;
}

export const DEFAULT_SESSION_KEY = 'three-path-editor:session';

export interface CreatePathOptions extends PathOptions {
  /** Select the new path. Default true. */
  select?: boolean;
}

export interface CreateMarkerOptions extends Omit<CreatePathOptions, 'points' | 'curve' | 'kind'> {
  /** Path-space position. Default: the middle of the view. */
  position?: ArrayLike<number>;
  /** Facing in degrees around the up axis. */
  yaw?: number;
}

/** A marker is one point with no curve, so these edits never apply to it. */
const MARKER_DENIED = new Set<EditorAction>(['addWaypoint', 'editCurve']);

type TransformControlsLike = TransformControls & { getHelper?: () => Object3D };

const CLICK_TOLERANCE_PX = 5;
/** Elements carrying this attribute (the panel, host dev UI) are never reported as blocking input. */
export const EDITOR_UI_ATTRIBUTE = 'data-path-editor-ui';
/** Set on `domElement` while the editor is enabled; `isolateUi` keeps it visible. */
export const EDITOR_VIEWPORT_ATTRIBUTE = 'data-path-editor-viewport';
const ISOLATED_CLASS = 'path-editor-isolated-ui';
const ISOLATION_STYLE_ID = 'three-path-editor-isolation-style';
// visibility, not display, so the host's layout keeps its size and comes back
// untouched; a visible descendant of a hidden element is still shown.
const ISOLATION_CSS = `
html.${ISOLATED_CLASS} body * { visibility: hidden !important; pointer-events: none !important; }
html.${ISOLATED_CLASS} [${EDITOR_VIEWPORT_ATTRIBUTE}],
html.${ISOLATED_CLASS} [${EDITOR_UI_ATTRIBUTE}],
html.${ISOLATED_CLASS} [${EDITOR_UI_ATTRIBUTE}] * { visibility: visible !important; pointer-events: auto !important; }
`;

function injectIsolationStyle(): void {
  if (document.getElementById(ISOLATION_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = ISOLATION_STYLE_ID;
  style.textContent = ISOLATION_CSS;
  document.head.appendChild(style);
}

/** Keeps authored angles short in JSON; a tenth of a degree is beyond notice. */
function roundAngle(degrees: number): number {
  const wrapped = ((((degrees + 180) % 360) + 360) % 360) - 180;
  return Number(wrapped.toFixed(1));
}

const _v = new Vector3();
const _target = new Vector3();
const _camera = new Vector3();
const _forward = new Vector3();
const _matrix = new Matrix4();
const _hits: Intersection[] = [];
const _ndc = new Vector2();

/**
 * In-game visual path editor. Plugs into an existing Three.js app: it never
 * creates a scene, camera, renderer or animation loop. Everything it draws
 * lives under `editor.root`, which is added to your scene on `enable()` and
 * removed on `disable()`.
 *
 * Call `editor.update(dt)` from your existing update loop.
 */
export class PathEditor {
  readonly root = new Group();
  readonly state: EditorState;
  /** Undo/redo stack (Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z). */
  readonly history: EditorHistory;
  readonly events = new Emitter<PathEditorEvents>();
  readonly scene: Object3D;
  readonly domElement: HTMLElement;
  readonly coordinates: CoordinateSystem;
  camera: Camera;
  cameraControls: CameraControlsLike | null;
  placement: PlacementProvider;
  /** See `PathEditorOptions.otherControls`. Host gizmos can be added later. */
  readonly otherControls: GizmoLike[];
  /** See `PathEditorOptions.claimPointer`. Can be replaced at any time. */
  claimPointer: ((event: PointerEvent) => boolean) | null;
  /** See `PathEditorOptions.constrainWaypoint`. Can be replaced at any time. */
  constrainWaypoint: WaypointConstraint | null;
  mirrorBezierHandles: boolean;

  private readonly renderOptions: Omit<ThreePathRendererOptions, 'coordinates'>;
  private readonly renderers = new Map<Path, ThreePathRenderer>();
  private readonly raycaster = new Raycaster();
  private readonly helpers = new Group();
  private readonly rigGroup = new Group();
  private readonly rigList: CameraRig[] = [];
  private rigMaterial: LineBasicMaterial | null = null;
  private readonly surfaceCheck: SurfaceCheck | null;
  private surfaceMaterial: LineBasicMaterial | null = null;
  private flight: { rig: CameraRig; elapsed: number; release: () => void; position: Vector3; quaternion: Quaternion } | null = null;
  private readonly gizmoProxy = new Object3D();
  private readonly keyboardShortcuts: boolean;
  private _gizmoMode: GizmoMode = 'translate';
  private readonly yawOrienters = new Map<PathDimension, Orienter>();
  private readonly diagnostics: boolean;
  private blockedInputWarned = false;
  private readonly restoreCameraOnDisable: boolean;
  private readonly detachCamera: boolean;
  private readonly isolateUi: boolean;
  private readonly pivot: PivotOptions | null;
  private detachedCamera: { parent: Object3D; camera: Camera } | null = null;
  private readonly canEditOption: PathEditorOptions['canEdit'];
  private savedCameraPose: { position: Vector3; quaternion: Quaternion; camera: Camera } | null = null;
  private transformControls: TransformControlsLike | null = null;
  private _enabled = false;
  private dragging = false;
  private cameraSuspensions = 0;
  private cameraControlsWereEnabled = true;
  private releaseDragCamera: (() => void) | null = null;
  private pointerDown: { x: number; y: number; gizmo: boolean } | null = null;
  private unbindShortcuts: (() => void) | null = null;
  private _preview: PathPreview | null = null;
  private ownedPreviewObject: Mesh | null = null;
  /** Unknown top-level keys of the last imported file, preserved on export. */
  private fileExtras: Record<string, unknown> = {};
  private disposed = false;

  constructor(options: PathEditorOptions) {
    const domElement = options.domElement ?? options.renderer?.domElement;
    if (!domElement) throw new Error('PathEditor: pass `renderer` or `domElement`.');
    this.scene = options.scene;
    this.camera = options.camera;
    this.domElement = domElement;
    this.coordinates = isCoordinateSystem(options.coordinates)
      ? options.coordinates
      : createCoordinateSystem(options.coordinates);
    this.cameraControls = options.cameraControls ?? null;
    this.otherControls = options.otherControls ?? [];
    this.claimPointer = options.claimPointer ?? null;
    this.placement = options.placement ?? planePlacement();
    this.constrainWaypoint = options.constrainWaypoint ?? null;
    this.keyboardShortcuts = options.keyboardShortcuts ?? true;
    this._gizmoMode = options.gizmoMode ?? 'translate';
    this.mirrorBezierHandles = options.mirrorBezierHandles ?? true;
    this.diagnostics = options.diagnostics ?? true;
    this.detachCamera = options.detachCamera ?? false;
    this.restoreCameraOnDisable = (options.restoreCameraOnDisable ?? false) || this.detachCamera;
    this.isolateUi = options.isolateUi ?? false;
    this.pivot = options.pivotUnderPointer
      ? typeof options.pivotUnderPointer === 'object'
        ? options.pivotUnderPointer
        : {}
      : null;
    this.canEditOption = options.canEdit;
    this.renderOptions = options.render ?? {};
    this.state = new EditorState(options.view);
    this.history = new EditorHistory(this.state, { limit: options.historyLimit });
    this.history.events.on('change', (e) => this.events.emit('history', e));

    this.root.name = 'PathEditorRoot';
    this.root.userData.pathEditor = true;
    this.gizmoProxy.name = 'PathEditorGizmoTarget';
    this.rigGroup.name = 'PathEditorRigs';
    this.rigGroup.userData.pathEditor = true;
    this.buildHelpers(options.grid ?? {});
    this.root.add(this.helpers, this.gizmoProxy, this.rigGroup);
    for (const rig of options.rigs ?? []) this.addRig(rig);
    this.surfaceCheck = options.surface ? this.buildSurfaceCheck(options.surface) : null;
    if (this.surfaceCheck) this.root.add(this.surfaceCheck.group);

    this.state.events.on('paths', () => this.syncRenderers());
    this.state.events.on('pathchange', (path) => this.events.emit('change', { path }));
    this.state.events.on('selection', (selection) => {
      this.syncSelection();
      this.events.emit('select', { ...selection });
    });
    this.state.events.on('view', (view) => {
      this.applyView();
      this.events.emit('view', view);
    });
    this.applyView();

    if (options.enabled) this.enable();
  }

  // ------------------------------------------------------------------ status

  get enabled(): boolean {
    return this._enabled;
  }

  get paths(): Path[] {
    return this.state.paths;
  }

  get selection(): Readonly<EditorSelection> {
    return this.state.selection;
  }

  get selectedPath(): Path | null {
    return this.state.selectedPath;
  }

  get preview(): PathPreview | null {
    return this._preview;
  }

  get view(): Readonly<EditorViewOptions> {
    return this.state.view;
  }

  /** See `PathEditorOptions.gizmoMode`. */
  get gizmoMode(): GizmoMode {
    return this._gizmoMode;
  }

  /**
   * Switches the gizmo between moving the selected waypoint and turning it
   * (authoring its `yaw`). Rotating needs the `editWaypointProperties`
   * permission, the same as speed and roll.
   */
  setGizmoMode(mode: GizmoMode): this {
    if (mode === this._gizmoMode) return this;
    this._gizmoMode = mode;
    this.transformControls?.setMode(mode);
    this.syncSelection();
    this.events.emit('gizmomode', mode);
    return this;
  }

  toggleGizmoMode(): this {
    return this.setGizmoMode(this._gizmoMode === 'translate' ? 'rotate' : 'translate');
  }

  on<K extends keyof PathEditorEvents>(type: K, listener: Listener<PathEditorEvents[K]>): () => void {
    return this.events.on(type, listener);
  }

  getPath(id: string): Path | undefined {
    return this.state.getPath(id);
  }

  getRenderer(path: Path): ThreePathRenderer | undefined {
    return this.renderers.get(path);
  }

  /**
   * Whether `action` is allowed on `path`: a marker never grows points or
   * curve settings, and beyond that whatever `canEdit` says (everything, when
   * no `canEdit` was given).
   */
  can(action: EditorAction, path: Path, waypointIndex: number | null = null): boolean {
    if (path.isMarker && MARKER_DENIED.has(action)) return false;
    return this.canEditOption?.(action, { path, waypointIndex }) ?? true;
  }

  /** `can()` that also emits `denied` when refused. */
  private allow(action: EditorAction, path: Path, waypointIndex: number | null = null): boolean {
    if (this.can(action, path, waypointIndex)) return true;
    this.events.emit('denied', { action, path, waypointIndex });
    return false;
  }

  // --------------------------------------------------------------- lifecycle

  /** Attaches the editor root to the scene and starts listening for input. */
  enable(): this {
    this.assertNotDisposed();
    if (this._enabled) return this;
    this._enabled = true;
    if (this.restoreCameraOnDisable) {
      this.savedCameraPose = {
        camera: this.camera,
        position: this.camera.position.clone(),
        quaternion: this.camera.quaternion.clone(),
      };
    }
    if (this.detachCamera) this.takeCameraOutOfRig();
    this.scene.add(this.root);
    const tc = this.ensureTransformControls();
    tc.enabled = true;
    // On `window` in the capture phase: listeners on the canvas itself run in
    // registration order, and TransformControls registered its own first, so
    // only a capture listener further up the tree can claim a press before it.
    if (typeof window !== 'undefined') {
      window.addEventListener('pointerdown', this.onPointerDown, { capture: true });
      window.addEventListener('pointerdown', this.onWindowPointerDown, { capture: true });
      if (this.pivot) {
        window.addEventListener('pointerdown', this.movePivot, { capture: true });
        window.addEventListener('wheel', this.movePivot, { capture: true, passive: true });
      }
    }
    this.domElement.addEventListener('pointerup', this.onPointerUp);
    this.domElement.addEventListener('dblclick', this.onDoubleClick);
    this.domElement.setAttribute(EDITOR_VIEWPORT_ATTRIBUTE, '');
    if (this.isolateUi) this.setUiIsolated(true);
    if (this.keyboardShortcuts && typeof window !== 'undefined') this.unbindShortcuts = bindShortcuts(this);
    this.syncSelection();
    this.events.emit('enabled', true);
    return this;
  }

  /** Detaches everything from the scene and stops listening. Paths are kept. */
  disable(): this {
    if (!this._enabled) return this;
    this._enabled = false;
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerdown', this.onPointerDown, { capture: true });
      window.removeEventListener('pointerdown', this.onWindowPointerDown, { capture: true });
      window.removeEventListener('pointerdown', this.movePivot, { capture: true });
      window.removeEventListener('wheel', this.movePivot, { capture: true });
    }
    this.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.domElement.removeEventListener('dblclick', this.onDoubleClick);
    this.domElement.removeAttribute(EDITOR_VIEWPORT_ATTRIBUTE);
    if (this.isolateUi) this.setUiIsolated(false);
    this.unbindShortcuts?.();
    this.unbindShortcuts = null;
    if (this.transformControls) {
      // Disabling TransformControls mid-drag leaves it dragging forever: it
      // ignores the pointerup that would have ended the drag, and then never
      // grabs another press.
      this.stopGizmoDrag();
      this.transformControls.detach();
      this.transformControls.enabled = false;
    }
    this.endDrag();
    this.root.removeFromParent();
    if (this.detachedCamera) this.putCameraBackInRig();
    if (this.savedCameraPose) {
      const { camera, position, quaternion } = this.savedCameraPose;
      camera.position.copy(position);
      camera.quaternion.copy(quaternion);
      camera.updateMatrixWorld();
      this.savedCameraPose = null;
    }
    this.events.emit('enabled', false);
    return this;
  }

  toggle(): this {
    return this._enabled ? this.disable() : this.enable();
  }

  /**
   * Switches the host's camera controls off until the returned function is
   * called. Suspensions are counted, so the editor's gizmo and a host gizmo
   * can hold one at the same time without either restoring the other's state
   * — what the controls had before the first suspension is what comes back
   * after the last release. Releasing twice does nothing.
   */
  suspendCameraControls(): () => void {
    const controls = this.cameraControls;
    if (this.cameraSuspensions++ === 0 && controls) {
      this.cameraControlsWereEnabled = controls.enabled;
      controls.enabled = false;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--this.cameraSuspensions > 0) return;
      const current = this.cameraControls;
      if (current) current.enabled = this.cameraControlsWereEnabled;
    };
  }

  /**
   * True while a gizmo owns the pointer: the editor's own is dragging or has an
   * axis under the pointer, or one of `otherControls` has. Host code can ask
   * this before treating a press as its own.
   */
  get gizmoEngaged(): boolean {
    return this.dragging || (this.transformControls?.axis ?? null) !== null || this.otherGizmoEngaged;
  }

  /**
   * The editor's own transform gizmo, as much of it as a host needs to see who
   * owns a press. Null until the first `enable()`.
   */
  get gizmo(): GizmoLike | null {
    return this.transformControls;
  }

  /** Disables the editor and releases every GPU resource and listener it created. */
  dispose(): void {
    if (this.disposed) return;
    this.disable();
    this.detachPreview();
    for (const rig of this.rigList.splice(0)) rig.dispose();
    this.rigMaterial?.dispose();
    this.rigMaterial = null;
    this.surfaceCheck?.dispose();
    this.surfaceMaterial?.dispose();
    this.surfaceMaterial = null;
    this.history.dispose();
    for (const renderer of this.renderers.values()) renderer.dispose();
    this.renderers.clear();
    this.state.clear();
    const tc = this.transformControls;
    if (tc) {
      (tc.getHelper?.() ?? tc).removeFromParent();
      tc.dispose();
    }
    this.helpers.traverse((o) => {
      const helper = o as Partial<GridHelper>;
      helper.geometry?.dispose();
      (helper as { dispose?: () => void }).dispose?.();
    });
    this.events.clear();
    this.disposed = true;
  }

  /** Call once per frame from the host application's loop. */
  update(dt = 0): void {
    if (!this._enabled) return;
    const height = this.domElement.clientHeight || 800;
    for (const renderer of this.renderers.values()) renderer.update(this.camera, height);
    if (!this.dragging) this.syncGizmoPosition();
    this._preview?.update(dt);
    for (const rig of this.rigList) rig.update(this.state.view.sightlines);
    this.surfaceCheck?.update(this.state.paths, this.state.view.surface);
    this.advanceFlight(dt);
  }

  /** Switch to a different camera (e.g. when the game changes cameras). */
  setCamera(camera: Camera): void {
    this.camera = camera;
    if (this.transformControls) (this.transformControls as unknown as { camera: Camera }).camera = camera;
  }

  // -------------------------------------------------------------- camera rigs

  /** Pairs a camera path with the path it looks at. See `CameraRig`. */
  addRig(options: CameraRigOptions): CameraRig {
    if (!this.rigMaterial) {
      this.rigMaterial = new LineBasicMaterial({
        color: 0x8be0ff,
        transparent: true,
        opacity: 0.45,
        depthTest: false,
        depthWrite: false,
      });
    }
    const rig = new CameraRig(options, {
      resolve: (id) => this.getPath(id),
      coordinates: this.coordinates,
      material: this.rigMaterial,
    });
    this.rigList.push(rig);
    this.rigGroup.add(rig.group);
    return rig;
  }

  removeRig(rig: CameraRig | string): void {
    const found = typeof rig === 'string' ? this.rigList.find((r) => r.id === rig) : rig;
    if (!found) return;
    if (this.flight?.rig === found) this.stopRig();
    this.rigList.splice(this.rigList.indexOf(found), 1);
    found.dispose();
  }

  get rigs(): readonly CameraRig[] {
    return this.rigList;
  }

  /** The surface-sag check, when a `surface` was given. See `SurfaceCheck`. */
  get surfaceWarnings(): SurfaceCheck | null {
    return this.surfaceCheck;
  }

  getRig(id: string): CameraRig | undefined {
    return this.rigList.find((rig) => rig.id === id);
  }

  /** The rig the editor's camera is currently flying, if any. */
  get flyingRig(): CameraRig | null {
    return this.flight?.rig ?? null;
  }

  /**
   * Flies the editor's camera along a rig, looking at the matching point of
   * its target path, so the framing can be judged without restarting the game.
   * The camera pose is restored when the flight ends or is stopped, and the
   * host's camera controls are suspended while it runs.
   */
  playRig(rig: CameraRig | string): boolean {
    const found = typeof rig === 'string' ? this.getRig(rig) : rig;
    if (!found || !found.sample(0, _v, _target)) return false;
    this.stopRig();
    this.flight = {
      rig: found,
      elapsed: 0,
      release: this.suspendCameraControls(),
      position: this.camera.position.clone(),
      quaternion: this.camera.quaternion.clone(),
    };
    this.applyFlight(0);
    this.events.emit('rigstate', { rig: found, playing: true });
    return true;
  }

  /** Stops a rig flight and puts the camera back where it was. */
  stopRig(): void {
    const flight = this.flight;
    if (!flight) return;
    this.flight = null;
    flight.release();
    this.camera.position.copy(flight.position);
    this.camera.quaternion.copy(flight.quaternion);
    this.camera.updateMatrixWorld();
    this.events.emit('rigstate', { rig: flight.rig, playing: false });
  }

  private buildSurfaceCheck(surface: NonNullable<PathEditorOptions['surface']>): SurfaceCheck {
    const options: SurfaceCheckOptions = Array.isArray(surface) || typeof surface === 'function' ? { objects: surface } : surface;
    this.surfaceMaterial = new LineBasicMaterial({
      color: 0xff4d6d,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    return new SurfaceCheck(options, { coordinates: this.coordinates, material: this.surfaceMaterial });
  }

  private advanceFlight(dt: number): void {
    const flight = this.flight;
    if (!flight) return;
    flight.elapsed += dt;
    const time = flight.rig.flightTime;
    const u = time > 0 ? flight.elapsed / time : 1;
    this.applyFlight(Math.min(u, 1));
    if (u >= 1) this.stopRig();
  }

  private applyFlight(u: number): void {
    const flight = this.flight!;
    if (!flight.rig.sample(u, _v, _target)) return;
    this.camera.position.copy(_v);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(_target);
    this.camera.updateMatrixWorld();
  }

  // ------------------------------------------------------------------- paths

  /** Creates a path, adds it to the editor and (by default) selects it. */
  createPath(options: CreatePathOptions = {}): Path {
    const { select = true, ...pathOptions } = options;
    const path = new Path(pathOptions);
    this.loadPath(path);
    if (select) this.state.select(path.id);
    return path;
  }

  /**
   * Creates a path with a few waypoints in front of the camera — handy for
   * "New path" buttons when you don't know the world scale.
   */
  createPathInView(options: CreatePathOptions & { pointCount?: number } = {}): Path {
    const dimension = options.dimension ?? 3;
    const center = this.getViewCenter(dimension);
    const camPos = _v.setFromMatrixPosition(this.camera.matrixWorld).clone();
    const spacing = Math.max(camPos.distanceTo(center) * 0.15, 1e-3);
    const right = new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const normal = dimension === 2 ? new Vector3(...this.coordinates.planeNormal) : new Vector3(0, 1, 0);
    right.addScaledVector(normal, -right.dot(normal));
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
    right.normalize();
    const count = Math.max(2, options.pointCount ?? 3);
    const points = Array.from({ length: count }, (_, i) => {
      const world = center.clone().addScaledVector(right, (i - (count - 1) / 2) * spacing);
      return this.coordinates.toPath(world.toArray(), dimension);
    });
    return this.createPath({ ...options, dimension, points: options.points ?? points });
  }

  /**
   * Creates a marker: one named place, no curve — a spawn point, a prop, a
   * light. It is a `Path` with `kind: 'marker'`, so it is selected, moved,
   * turned, undone and saved exactly like a path, and lives in the same file.
   * Without a position it lands in the middle of the view.
   */
  createMarker(options: CreateMarkerOptions = {}): Path {
    const dimension = options.dimension ?? 3;
    const position = options.position ?? this.coordinates.toPath(this.getViewCenter(dimension).toArray(), dimension);
    const marker = this.createPath({
      ...options,
      kind: 'marker',
      dimension,
      points: [{ position, yaw: options.yaw }],
    });
    return marker;
  }

  /** Markers only (`kind: 'marker'`). `paths` holds both. */
  get markers(): Path[] {
    return this.state.paths.filter((path) => path.isMarker);
  }

  /** Routes only, i.e. everything that is not a marker. `paths` holds both. */
  get routes(): Path[] {
    return this.state.paths.filter((path) => !path.isMarker);
  }

  /** Adds a Path (or PathData) to the editor, replacing a path with the same id. */
  loadPath(path: Path | PathData): Path {
    const instance = path instanceof Path ? path : Path.fromJSON(path);
    this.state.addPath(instance);
    return instance;
  }

  removePath(id: string): Path | undefined {
    const path = this.getPath(id);
    if (!path || !this.allow('deletePath', path)) return undefined;
    return this.state.removePath(id);
  }

  /** Deletes the selected path entirely. Returns the removed path. */
  deleteSelectedPath(): Path | undefined {
    const path = this.selectedPath;
    return path ? this.removePath(path.id) : undefined;
  }

  renamePath(oldId: string, newId: string): boolean {
    const path = this.getPath(oldId);
    if (!path || !this.allow('renamePath', path)) return false;
    return this.state.renamePath(oldId, newId);
  }

  /**
   * Loads a path file (object or JSON string). Replaces all paths unless
   * `merge` is true. Unknown fields and metadata are preserved.
   */
  import(data: PathFileData | string | unknown, options: { merge?: boolean; clearHistory?: boolean } = {}): Path[] {
    const file = readPathFile(data);
    if (!options.merge) {
      this.detachPreview();
      this.state.clear();
    }
    this.fileExtras = { ...(options.merge ? this.fileExtras : {}), ...file.extras };
    for (const path of file.paths) this.state.addPath(path);
    if (file.paths[0]) this.state.select(file.paths[0].id);
    // Loading a file starts a fresh history by default (like opening a document).
    if (options.clearHistory ?? !options.merge) this.history.clear();
    else this.history.flush();
    this.events.emit('import', { paths: file.paths });
    return file.paths;
  }

  /** Exports all paths in the versioned JSON format. */
  export(): PathFileData {
    return serializePaths(this.state.paths, this.fileExtras);
  }

  exportString(indent = 2): string {
    return stringifyPaths(this.state.paths, indent, this.fileExtras);
  }

  // --------------------------------------------------------------- selection

  select(pathId: string | null, waypointIndex: number | null = null, handle: HandleKind | null = null): void {
    this.state.select(pathId, waypointIndex, handle);
  }

  clearSelection(): void {
    this.state.select(null);
  }

  /** Deselects the waypoint but keeps the path selected. */
  clearWaypointSelection(): void {
    this.state.select(this.state.selection.pathId);
  }

  selectAdjacentWaypoint(delta: -1 | 1): void {
    const path = this.selectedPath;
    if (!path || path.waypoints.length === 0) return;
    const n = path.waypoints.length;
    const current = this.selection.waypointIndex;
    const next = current === null ? (delta > 0 ? 0 : n - 1) : (current + delta + n) % n;
    this.state.select(path.id, next);
  }

  // ---------------------------------------------------------------- editing

  /**
   * Adds a waypoint. Defaults: selected path, after the selected waypoint (or
   * at the end), position suggested from neighbours. Returns the new index.
   */
  addWaypoint(options: { pathId?: string; index?: number; position?: ArrayLike<number>; select?: boolean } = {}): number | null {
    const path = options.pathId ? this.getPath(options.pathId) : this.selectedPath;
    if (!path || !this.allow('addWaypoint', path)) return null;
    let index: number;
    if (options.index !== undefined) {
      index = Math.min(Math.max(options.index, 0), path.waypoints.length);
      path.addWaypoint(options.position ?? insertPositionAt(path, index), index);
    } else {
      const after = this.selection.pathId === path.id ? this.selection.waypointIndex : null;
      index = insertWaypointAfter(path, after, options.position);
    }
    this.applyConstraint(path, index);
    if (options.select ?? true) this.state.select(path.id, index);
    return index;
  }

  /** Adds a waypoint where the pointer ray hits the placement surface. */
  addWaypointAtScreen(clientX: number, clientY: number): number | null {
    const path = this.selectedPath;
    if (!path || !this.allow('addWaypoint', path)) return null;
    this.setRayFromScreen(clientX, clientY);
    const refIndex = this.selection.waypointIndex ?? path.waypoints.length - 1;
    const renderer = this.renderers.get(path);
    const reference = refIndex >= 0 && renderer ? renderer.getWaypointWorld(refIndex) : null;
    const world = this.placement({
      raycaster: this.raycaster,
      path,
      reference,
      planeNormal: new Vector3(...this.coordinates.planeNormal),
      planeOrigin: new Vector3(...this.coordinates.toWorld([0, 0, 0], 2)),
    });
    if (!world) return null;
    return this.addWaypoint({ position: this.coordinates.toPath(world.toArray(), path.dimension) });
  }

  /**
   * Inserts a waypoint on the curve of `pathId` at parameter t (keeps the
   * curve shape; exact for Bezier). Returns the new index.
   */
  insertWaypointAt(pathId: string, t: number, options: { select?: boolean } = {}): number | null {
    const path = this.getPath(pathId);
    if (!path || !this.allow('addWaypoint', path)) return null;
    const index = insertWaypointAtT(path, t);
    this.applyConstraint(path, index);
    if (options.select ?? true) this.state.select(path.id, index);
    return index;
  }

  /** Inserts a waypoint where the screen position hits a path line. Returns the index or null. */
  insertWaypointAtScreen(clientX: number, clientY: number): number | null {
    const hit = this.pick(clientX, clientY);
    if (!hit || hit.kind !== 'line' || hit.t === null) return null;
    return this.insertWaypointAt(hit.path.id, hit.t);
  }

  deleteSelectedWaypoint(): void {
    const { pathId, waypointIndex } = this.selection;
    if (pathId === null || waypointIndex === null) return;
    this.removeWaypoint(pathId, waypointIndex);
  }

  removeWaypoint(pathId: string, index: number): void {
    const path = this.getPath(pathId);
    if (!path || !path.waypoints[index] || !this.allow('deleteWaypoint', path, index)) return;
    const waypoint = path.removeWaypoint(index)!;
    const n = path.waypoints.length;
    this.state.select(path.id, n === 0 ? null : Math.min(index, n - 1));
    // In the same synchronous task as the removal, so edits a listener makes
    // (handing a name on to a neighbour, say) land in the same undo step.
    this.events.emit('waypointremoved', { path, index, waypoint });
  }

  /** Moves a waypoint to a new position (path space). */
  moveWaypoint(pathId: string, index: number, position: ArrayLike<number>): void {
    const path = this.getPath(pathId);
    if (!path || !path.waypoints[index] || !this.allow('moveWaypoint', path, index)) return;
    path.moveWaypoint(index, this.constrained(path, index, position));
  }

  /**
   * Runs `constrainWaypoint` over every waypoint of `pathId` (default: all
   * paths), e.g. right after `import()` to snap existing routes onto the
   * terrain. Undoes as one step, like any other synchronous change.
   */
  applyConstraints(pathId?: string): void {
    if (!this.constrainWaypoint) return;
    const paths = pathId ? [this.getPath(pathId)].filter((p): p is Path => !!p) : this.paths;
    for (const path of paths) path.waypoints.forEach((_, i) => this.applyConstraint(path, i));
  }

  reorderWaypoint(pathId: string, from: number, to: number): void {
    const path = this.getPath(pathId);
    if (!path || !this.allow('reorderWaypoint', path, from)) return;
    path.reorderWaypoint(from, to);
    if (this.selection.pathId === pathId && this.selection.waypointIndex === from) {
      this.state.select(pathId, Math.min(Math.max(to, 0), path.waypoints.length - 1));
    }
  }

  /** Moves the selected waypoint one step earlier (-1) or later (+1). */
  shiftSelectedWaypoint(delta: -1 | 1): void {
    const path = this.selectedPath;
    const index = this.selection.waypointIndex;
    if (!path || index === null || !this.allow('reorderWaypoint', path, index)) return;
    this.state.select(path.id, shiftWaypoint(path, index, delta));
  }

  // ----------------------------------------------------------------- history

  /** Reverts the last change. Returns false if there is nothing to undo. */
  undo(): boolean {
    return this.history.undo();
  }

  /** Re-applies the last undone change. */
  redo(): boolean {
    return this.history.redo();
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  // -------------------------------------------------------------------- view

  setView(options: Partial<EditorViewOptions>): void {
    this.state.setView(options);
  }

  toggleView(key: keyof EditorViewOptions): boolean {
    return this.state.toggleView(key);
  }

  // ----------------------------------------------------------------- preview

  /**
   * Plays an object along a path (default: the selected path). Without an
   * object, an editor-owned arrow marker is used. Only one preview at a time.
   */
  attachPreview(object?: Object3D | null, path?: Path | string | null, options: PathPreviewOptions = {}): PathPreview | null {
    const target = typeof path === 'string' ? this.getPath(path) : path ?? this.selectedPath ?? this.paths[0];
    if (!target) return null;
    this.detachPreview();
    let subject = object ?? null;
    if (!subject) {
      subject = this.ownedPreviewObject = this.createPreviewMarker(target);
      this.root.add(subject);
    }
    const preview = (this._preview = new PathPreview(subject, target, { coordinates: this.coordinates, ...options }));
    // Removed by preview.detach(), after it emits its final pause.
    preview.on('play', () => this.events.emit('previewstate', { preview, playing: true }));
    preview.on('pause', () => this.events.emit('previewstate', { preview, playing: false }));
    this.events.emit('preview', preview);
    if (preview.isPlaying) this.events.emit('previewstate', { preview, playing: true });
    return preview;
  }

  /** Previews `path`: retargets the current preview (keeping its object) or starts one with the marker. */
  previewPath(path: Path | string): PathPreview | null {
    const target = typeof path === 'string' ? this.getPath(path) : path;
    if (!target) return null;
    if (this._preview) {
      this._preview.setPath(target).reset().play();
      this.events.emit('preview', this._preview);
      return this._preview;
    }
    return this.attachPreview(null, target);
  }

  /** Stops the preview; restores the object's original transform by default. */
  detachPreview(): void {
    if (!this._preview) return;
    this._preview.detach();
    this._preview = null;
    if (this.ownedPreviewObject) {
      this.ownedPreviewObject.removeFromParent();
      this.ownedPreviewObject.geometry.dispose();
      (this.ownedPreviewObject.material as MeshBasicMaterial).dispose();
      this.ownedPreviewObject = null;
    }
    this.events.emit('preview', null);
  }

  // ----------------------------------------------------------------- session

  /**
   * Stores whether the editor is on, the selection, view toggles and the
   * camera pose in `sessionStorage`, so `restoreSession()` can pick up where
   * you were after a reload (e.g. right before saving a path file that makes
   * the dev server reload the page). Returns false if storage is unavailable.
   */
  saveSession(key = DEFAULT_SESSION_KEY, storage: SessionStorageLike | undefined = defaultSessionStorage()): boolean {
    if (!storage) return false;
    const state: EditorSessionState = {
      version: 1,
      enabled: this._enabled,
      selection: { ...this.selection },
      view: { ...this.view },
      camera: { position: this.camera.position.toArray(), quaternion: this.camera.quaternion.toArray() },
      gizmoMode: this._gizmoMode,
    };
    try {
      storage.setItem(key, JSON.stringify(state));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Applies a state stored by `saveSession()`: view toggles, selection (paths
   * that no longer exist are skipped), and, if the editor was on, enables it
   * and restores the camera pose. Consumed by default. Returns false when
   * nothing usable was stored.
   */
  restoreSession(key = DEFAULT_SESSION_KEY, options: RestoreSessionOptions = {}): boolean {
    const storage = options.storage ?? defaultSessionStorage();
    if (!storage) return false;
    let state: Partial<EditorSessionState> | null = null;
    try {
      const raw = storage.getItem(key);
      if (!options.keep) storage.removeItem(key);
      state = raw ? (JSON.parse(raw) as Partial<EditorSessionState>) : null;
    } catch {
      return false;
    }
    if (!state || state.version !== 1) return false;
    if (state.view) this.setView(state.view);
    if (state.gizmoMode === 'rotate' || state.gizmoMode === 'translate') this.setGizmoMode(state.gizmoMode);
    const selection = state.selection;
    if (selection?.pathId && this.getPath(selection.pathId)) {
      const path = this.getPath(selection.pathId)!;
      const index = selection.waypointIndex !== null && selection.waypointIndex < path.waypoints.length ? selection.waypointIndex : null;
      this.select(path.id, index, index === null ? null : selection.handle);
    }
    if (state.enabled) {
      this.enable();
      const camera = state.camera;
      if ((options.camera ?? true) && camera?.position?.length === 3 && camera.quaternion?.length === 4) {
        this.camera.position.fromArray(camera.position);
        this.camera.quaternion.fromArray(camera.quaternion);
        this.camera.updateMatrixWorld();
      }
    }
    return true;
  }

  // ---------------------------------------------------------------- picking

  /** Raycasts editor objects under a screen position (client coordinates). */
  pick(clientX: number, clientY: number, options: { markersOnly?: boolean } = {}): PickResult | null {
    this.setRayFromScreen(clientX, clientY);
    const height = this.domElement.clientHeight || 800;
    const candidates: { hit: Intersection; data: PathPickData; path: Path; priority: number }[] = [];
    for (const [path, renderer] of this.renderers) {
      if (!renderer.group.visible) continue;
      const { markers, line } = renderer.getPickables();
      for (const hit of this.raycaster.intersectObjects(markers, false)) {
        const data = hit.object.userData as PathPickData;
        candidates.push({ hit, data, path, priority: data.kind === 'handle' ? 0 : 1 });
      }
      if (line && !options.markersOnly) {
        line.geometry.computeBoundingSphere();
        const center = line.geometry.boundingSphere?.center ?? _v.set(0, 0, 0);
        this.raycaster.params.Line = { threshold: worldUnitsPerPixel(this.camera, center, height) * 6 };
        for (const hit of this.raycaster.intersectObject(line, false)) {
          candidates.push({ hit, data: line.userData as PathPickData, path, priority: 2 });
        }
      }
    }
    candidates.sort((a, b) => a.priority - b.priority || a.hit.distance - b.hit.distance);
    const best = candidates[0];
    if (!best) return null;
    let t: number | null = null;
    let point = best.hit.point.clone();
    if (best.data.kind === 'line') {
      const onLine = (best.hit as Intersection & { pointOnLine?: Vector3 }).pointOnLine ?? best.hit.point;
      const closest = best.path.getClosestPoint(this.coordinates.toPath(onLine.toArray(), best.path.dimension));
      t = closest.t;
      point = new Vector3().fromArray(this.coordinates.toWorld(closest.point, best.path.dimension));
    }
    return {
      kind: best.data.kind,
      path: best.path,
      waypointIndex: best.data.waypointIndex ?? null,
      handle: best.data.handle ?? null,
      point,
      t,
    };
  }

  /** Sets up the internal raycaster for a screen position and returns it (e.g. for custom placement). */
  setRayFromScreen(clientX: number, clientY: number): Raycaster {
    const rect = this.domElement.getBoundingClientRect();
    _ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(_ndc, this.camera);
    return this.raycaster;
  }

  /** Point the camera is looking at on the ground plane (or 10 units ahead). */
  getViewCenter(dimension: 2 | 3 = 3): Vector3 {
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(_ndc.set(0, 0), this.camera);
    const normal = dimension === 2 ? new Vector3(...this.coordinates.planeNormal) : new Vector3(0, 1, 0);
    const origin = new Vector3(...this.coordinates.toWorld([0, 0, 0], 2));
    const plane = new Plane().setFromNormalAndCoplanarPoint(normal, origin);
    const hit = this.raycaster.ray.intersectPlane(plane, new Vector3());
    const camPos = this.raycaster.ray.origin;
    if (hit && hit.distanceTo(camPos) < ((this.camera as { far?: number }).far ?? Infinity) * 0.5) return hit;
    return this.raycaster.ray.at(10, new Vector3());
  }

  // ---------------------------------------------------------------- internal

  /**
   * Registered on `window` in the capture phase, so it runs before the
   * listeners TransformControls and the camera controls put on the canvas.
   * Pressing a marker that is not the current gizmo target selects it
   * immediately and stops the event — otherwise gizmo arrows that overlap
   * nearby markers (e.g. Bezier handles) would steal the click.
   */
  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 || !this.isInViewport(e.target)) return;
    if (this.claimPointer?.(e)) {
      this.pointerDown = null;
      return;
    }
    const tc = this.transformControls;
    if (!e.shiftKey && !this.dragging && !this.otherGizmoEngaged) {
      const hit = this.pick(e.clientX, e.clientY, { markersOnly: true });
      const sel = this.selection;
      const isGizmoTarget =
        hit !== null && hit.path.id === sel.pathId && hit.waypointIndex === sel.waypointIndex && hit.handle === sel.handle;
      if (hit && !isGizmoTarget) {
        e.stopImmediatePropagation();
        this.pointerDown = null;
        this.state.select(hit.path.id, hit.waypointIndex, hit.handle);
        return;
      }
    }
    this.pointerDown = {
      x: e.clientX,
      y: e.clientY,
      gizmo: this.dragging || (tc?.axis ?? null) !== null || this.otherGizmoEngaged,
    };
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    const down = this.pointerDown;
    this.pointerDown = null;
    if (!down || e.button !== 0 || down.gizmo) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_TOLERANCE_PX) return; // camera drag
    const hit = this.pick(e.clientX, e.clientY);
    if (e.shiftKey) {
      // Shift+click on a curve inserts there; elsewhere appends via placement.
      if (hit?.kind === 'line' && hit.t !== null) this.insertWaypointAt(hit.path.id, hit.t);
      else if (hit) this.state.select(hit.path.id, hit.waypointIndex, hit.handle);
      else this.addWaypointAtScreen(e.clientX, e.clientY);
      return;
    }
    if (!hit) this.clearWaypointSelection();
    else if (hit.kind === 'line') this.state.select(hit.path.id);
    else this.state.select(hit.path.id, hit.waypointIndex, hit.handle);
  };

  /** Detects overlays that swallow presses meant for `domElement` (see `diagnostics`). */
  private readonly onWindowPointerDown = (e: PointerEvent): void => {
    const target = e.target;
    if (!(target instanceof Element) || this.domElement.contains(target)) return;
    if (target.closest(`[${EDITOR_UI_ATTRIBUTE}]`)) return;
    const rect = this.domElement.getBoundingClientRect();
    const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (!inside || rect.width === 0 || rect.height === 0) return;
    this.events.emit('inputblocked', { target, event: e });
    if (!this.diagnostics || this.blockedInputWarned) return;
    this.blockedInputWarned = true;
    console.warn(
      `three-path-editor: a click inside the editor area went to ${describeElement(target)} instead of ` +
        `${describeElement(this.domElement)}, so the editor never saw it. Something covers the canvas. ` +
        `Give the covering element \`pointer-events: none\` while editing, or pass an element that does ` +
        `receive the input (and covers the canvas exactly) as the \`domElement\` option. ` +
        `Add the \`${EDITOR_UI_ATTRIBUTE}\` attribute to your own dev UI to exclude it from this check.`,
    );
  };

  /** Double-click on a curve inserts a waypoint there. */
  private readonly onDoubleClick = (e: MouseEvent): void => {
    if (this.dragging) return;
    this.insertWaypointAtScreen(e.clientX, e.clientY);
  };

  /** Yaw is measured around the path's up axis, which the 2D plane can change. */
  private yawOrienter(dimension: PathDimension): Orienter {
    let orienter = this.yawOrienters.get(dimension);
    if (!orienter) {
      orienter = new Orienter({ worldUp: pathUp(this.coordinates, dimension).toArray() as [number, number, number], yawOnly: true });
      this.yawOrienters.set(dimension, orienter);
    }
    return orienter;
  }

  /** A press on a host gizmo is the host's, not a click into empty space. */
  private get otherGizmoEngaged(): boolean {
    return this.otherControls.some((controls) => controls.axis !== null || controls.dragging === true);
  }

  private isInViewport(target: EventTarget | null): boolean {
    return target instanceof Node && this.domElement.contains(target);
  }

  /**
   * Keeps the orbit pivot on the surface under the pointer, at the same depth
   * along the view axis, so the view never jumps while zoom and pan keep
   * usable steps. Runs before the camera controls handle the same event.
   */
  private readonly movePivot = (e: PointerEvent | WheelEvent): void => {
    const controls = this.cameraControls;
    const pivot = this.pivot;
    if (!pivot || !controls?.target || controls.enabled === false || !this.isInViewport(e.target)) return;
    this.camera.updateMatrixWorld();
    this.camera.getWorldPosition(_camera);
    this.camera.getWorldDirection(_forward);
    this.setRayFromScreen(e.clientX, e.clientY);
    const targets = typeof pivot.objects === 'function' ? pivot.objects() : pivot.objects ?? this.scene.children;
    _hits.length = 0;
    this.raycaster.intersectObjects(targets, true, _hits);
    const hit = _hits.find((candidate) => !isEditorObject(candidate.object));
    _hits.length = 0;
    const depth = hit ? _v.subVectors(hit.point, _camera).dot(_forward) : _camera.distanceTo(controls.target);
    controls.target.copy(_camera).addScaledVector(_forward, Math.max(depth, pivot.minDistance ?? 1));
  };

  /** Ends a TransformControls drag that is in progress, without its event. */
  private stopGizmoDrag(): void {
    const tc = this.transformControls as (TransformControlsLike & { dragging: boolean }) | null;
    if (!tc?.dragging) return;
    tc.axis = null;
    tc.dragging = false;
  }

  /**
   * Camera controls cannot orbit a camera a rig drives, so the camera is moved
   * into the scene for the session, keeping its world pose.
   */
  private takeCameraOutOfRig(): void {
    const camera = this.camera;
    const parent = camera.parent;
    if (!parent || parent === this.scene) return;
    this.scene.updateWorldMatrix(true, false);
    camera.updateWorldMatrix(true, false);
    _matrix.copy(this.scene.matrixWorld).invert().multiply(camera.matrixWorld);
    this.detachedCamera = { parent, camera };
    this.scene.add(camera);
    _matrix.decompose(camera.position, camera.quaternion, camera.scale);
    camera.updateMatrixWorld();
  }

  private putCameraBackInRig(): void {
    const { parent, camera } = this.detachedCamera!;
    this.detachedCamera = null;
    parent.add(camera);
    camera.updateMatrixWorld();
  }

  /** Hides and blocks everything but the viewport and the editor's own UI. */
  private setUiIsolated(isolated: boolean): void {
    if (typeof document === 'undefined') return;
    if (isolated) injectIsolationStyle();
    document.documentElement.classList.toggle(ISOLATED_CLASS, isolated);
  }

  private ensureTransformControls(): TransformControlsLike {
    if (this.transformControls) return this.transformControls;
    const tc = new TransformControls(this.camera, this.domElement) as TransformControlsLike;
    tc.setMode('translate');
    const helper = typeof tc.getHelper === 'function' ? tc.getHelper() : (tc as unknown as Object3D);
    helper.userData.pathEditor = true;
    this.root.add(helper);
    tc.addEventListener('dragging-changed', (event) => {
      if ((event as { value?: unknown }).value) this.beginDrag();
      else this.endDrag();
    });
    tc.addEventListener('objectChange', () => this.onGizmoMoved());
    this.transformControls = tc;
    return tc;
  }

  private beginDrag(): void {
    if (this.dragging) return;
    this.dragging = true;
    this.history.begin(); // the whole drag is one undo step
    this.releaseDragCamera = this.suspendCameraControls();
    const { waypointIndex } = this.selection;
    const path = this.selectedPath;
    if (path && waypointIndex !== null) this.events.emit('dragstart', { path, waypointIndex });
  }

  private endDrag(): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.history.end();
    this.releaseDragCamera?.();
    this.releaseDragCamera = null;
    const { waypointIndex } = this.selection;
    const path = this.selectedPath;
    if (path && waypointIndex !== null) this.events.emit('dragend', { path, waypointIndex });
  }

  private onGizmoMoved(): void {
    const path = this.selectedPath;
    const { waypointIndex, handle } = this.selection;
    if (!path || waypointIndex === null) return;
    if (this._gizmoMode === 'rotate') {
      const radians = this.yawOrienter(path.dimension).yawOf(this.gizmoProxy.quaternion);
      path.setWaypointProperties(waypointIndex, { yaw: roundAngle((radians * 180) / Math.PI) });
      this.syncGizmoPosition();
      return;
    }
    const p = this.coordinates.toPath(this.gizmoProxy.position.toArray(), path.dimension);
    if (!handle) {
      const constrained = this.constrained(path, waypointIndex, p);
      path.moveWaypoint(waypointIndex, constrained);
      if (constrained !== p) this.gizmoProxy.position.fromArray(this.coordinates.toWorld(toVec3(constrained), path.dimension));
      return;
    }
    const wp = path.waypoints[waypointIndex];
    const current = path.getBezierHandles(waypointIndex)!;
    const moved = sub(p, wp.position);
    const other = handle === 'in' ? current.handleOut : current.handleIn;
    let mirrored = other;
    if (this.mirrorBezierHandles && vecLength(moved) > 1e-9) {
      mirrored = scale(normalize(moved), -(vecLength(other) || vecLength(moved)));
    }
    path.setWaypointHandles(
      waypointIndex,
      handle === 'in' ? { handleIn: moved, handleOut: mirrored } : { handleOut: moved, handleIn: mirrored },
    );
  }

  /** `position` (path space) after `constrainWaypoint`; the same array when unchanged. */
  private constrained(path: Path, waypointIndex: number, position: ArrayLike<number>): ArrayLike<number> {
    if (!this.constrainWaypoint) return position;
    const world = new Vector3().fromArray(this.coordinates.toWorld(toVec3(position), path.dimension));
    const result = this.constrainWaypoint({ path, waypointIndex, position: world });
    if (!result) return position;
    return this.coordinates.toPath(result.toArray(), path.dimension);
  }

  private applyConstraint(path: Path, index: number): void {
    const wp = path.waypoints[index];
    if (!wp || !this.constrainWaypoint) return;
    const next = this.constrained(path, index, wp.position);
    if (next !== wp.position && Array.from(next).some((v, c) => Math.abs(v - wp.position[c]) > 1e-9)) path.moveWaypoint(index, next);
  }

  /** Puts the gizmo on the selected waypoint/handle, or hides it. */
  private syncSelection(): void {
    const { pathId, waypointIndex, handle } = this.selection;
    for (const [path, renderer] of this.renderers) {
      renderer.setSelection(path.id === pathId, path.id === pathId ? waypointIndex : null, handle);
    }
    const tc = this.transformControls;
    if (!tc) return;
    const path = this.selectedPath;
    const rotating = this._gizmoMode === 'rotate';
    const action: EditorAction = rotating ? 'editWaypointProperties' : 'moveWaypoint';
    const usable = rotating ? waypointIndex !== null && !handle : waypointIndex !== null;
    if (!this._enabled || !this.state.view.gizmos || !path || !usable || !this.can(action, path, waypointIndex)) {
      tc.detach();
      return;
    }
    tc.setMode(this._gizmoMode);
    this.syncGizmoPosition();
    if (rotating) {
      // Only the axis the yaw turns around: a free rotation would tilt the
      // proxy, and `yaw` holds a heading, nothing else.
      const up = pathUp(this.coordinates, path.dimension, _v);
      const axisAligned = Math.max(Math.abs(up.x), Math.abs(up.y), Math.abs(up.z)) > 0.99;
      tc.showX = !axisAligned || Math.abs(up.x) > 0.99;
      tc.showY = !axisAligned || Math.abs(up.y) > 0.99;
      tc.showZ = !axisAligned || Math.abs(up.z) > 0.99;
    } else {
      // For 2D paths only show the axes of the path plane.
      const n = this.coordinates.planeNormal;
      const is2D = path.dimension === 2;
      tc.showX = !(is2D && Math.abs(n[0]) > 0.99);
      tc.showY = !(is2D && Math.abs(n[1]) > 0.99);
      tc.showZ = !(is2D && Math.abs(n[2]) > 0.99);
    }
    if (tc.object !== this.gizmoProxy) tc.attach(this.gizmoProxy);
  }

  private syncGizmoPosition(): void {
    const path = this.selectedPath;
    const { waypointIndex, handle } = this.selection;
    const renderer = path ? this.renderers.get(path) : undefined;
    if (!renderer || waypointIndex === null) return;
    if (handle) renderer.getHandleWorld(waypointIndex, handle, this.gizmoProxy.position);
    else renderer.getWaypointWorld(waypointIndex, this.gizmoProxy.position);
    if (path && this._gizmoMode === 'rotate') {
      const yaw = path.waypoints[waypointIndex]?.yaw ?? 0;
      this.yawOrienter(path.dimension).yawTo((yaw * Math.PI) / 180, this.gizmoProxy.quaternion);
    }
    this.gizmoProxy.updateMatrixWorld();
  }

  private syncRenderers(): void {
    const paths = new Set(this.state.paths);
    for (const [path, renderer] of this.renderers) {
      if (!paths.has(path)) {
        renderer.dispose();
        this.renderers.delete(path);
        if (this._preview?.path === path) this.detachPreview();
        this.events.emit('pathremoved', { path });
      }
    }
    for (const path of paths) {
      if (this.renderers.has(path)) continue;
      const renderer = new ThreePathRenderer(path, { ...this.renderOptions, coordinates: this.coordinates });
      this.renderers.set(path, renderer);
      this.root.add(renderer.group);
      this.events.emit('pathadded', { path });
    }
    this.applyView();
    this.syncSelection();
  }

  private applyView(): void {
    const view = this.state.view;
    this.helpers.visible = view.grid;
    for (const renderer of this.renderers.values()) {
      renderer.group.visible = view.paths;
      renderer.setOptions({
        showArrows: view.directions,
        showFacings: view.facings,
        showLabels: view.labels,
        showDebug: view.debug,
      });
    }
    this.syncSelection();
  }

  private buildHelpers(grid: NonNullable<PathEditorOptions['grid']>): void {
    const size = grid.size ?? 100;
    const gridHelper = new GridHelper(size, grid.divisions ?? 20, grid.centerColor ?? 0x6b7a90, grid.color ?? 0x3a4250);
    const axes = new AxesHelper(size * 0.05);
    for (const helper of [gridHelper, axes]) {
      helper.userData.pathEditor = true;
      helper.renderOrder = 999;
    }
    // GridHelper lies on XZ; rotate it onto the 2D plane when that plane is XY.
    const n = this.coordinates.planeNormal;
    if (Math.abs(n[2]) > 0.99) gridHelper.rotation.x = Math.PI / 2;
    gridHelper.position.fromArray(this.coordinates.toWorld([0, 0, 0], 2));
    this.helpers.name = 'PathEditorHelpers';
    this.helpers.add(gridHelper, axes);
  }

  private createPreviewMarker(path: Path): Mesh {
    // Flat arrow pointing +Z (the follower's default forward axis), wide in X
    // and thin in Y so roll/bank is visible.
    const geometry = new ConeGeometry(0.5, 1.6, 4).rotateX(Math.PI / 2).scale(1.4, 0.25, 1);
    const size = Math.max(averageSpacing(path, 10) * 0.15, 1e-3);
    geometry.scale(size, size, size);
    const marker = new Mesh(geometry, new MeshBasicMaterial({ color: 0xff7a1a, depthTest: false, transparent: true }));
    marker.name = 'PathEditorPreviewMarker';
    marker.renderOrder = 1001;
    marker.userData.pathEditor = true;
    return marker;
  }

  private assertNotDisposed(): void {
    if (this.disposed) throw new Error('PathEditor has been disposed.');
  }
}

function defaultSessionStorage(): SessionStorageLike | undefined {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}

/** `tag#id.class` for diagnostics. */
function describeElement(el: Element): string {
  const id = el.id ? `#${el.id}` : '';
  const classes = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).join('.')}` : '';
  return `<${el.tagName.toLowerCase()}${id}${classes}>`;
}

function isCoordinateSystem(value: unknown): value is CoordinateSystem {
  return typeof value === 'object' && value !== null && typeof (value as CoordinateSystem).toWorld === 'function';
}

/** Suggested position for inserting at `index` (before the waypoint currently there). */
function insertPositionAt(path: Path, index: number): number[] {
  const pts = path.waypoints;
  if (pts.length === 0) return [0, 0, 0];
  if (index >= pts.length) return [...add(pts[pts.length - 1].position, [averageSpacing(path), 0, 0])];
  if (index === 0) return [...sub(pts[0].position, pts.length > 1 ? sub(pts[1].position, pts[0].position) : [averageSpacing(path), 0, 0])];
  return [...toVec3(path.getPoint((index - 0.5) / path.segmentCount))];
}
