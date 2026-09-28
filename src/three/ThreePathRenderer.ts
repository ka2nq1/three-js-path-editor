import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  ConeGeometry,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Quaternion,
  Vector3,
  type Camera,
  type ColorRepresentation,
  type Material,
  type Object3D,
} from 'three';
import { defaultCoordinateSystem, type CoordinateSystem } from '../core/coordinates';
import type { Path } from '../core/Path';
import type { Waypoint } from '../core/Waypoint';
import type { HandleKind } from '../editor/EditorState';
import { Orienter } from '../runtime/orientation';
import { add, type Vec3 } from '../utils/vec3';
import { worldUnitsPerPixel } from './screen';

export interface PathRenderStyle {
  lineColor: ColorRepresentation;
  selectedLineColor: ColorRepresentation;
  pointColor: ColorRepresentation;
  /** Colour of the first waypoint (shows where the path starts). */
  startPointColor: ColorRepresentation;
  selectedPointColor: ColorRepresentation;
  handleColor: ColorRepresentation;
  arrowColor: ColorRepresentation;
  debugColor: ColorRepresentation;
  labelColor: string;
  /** Waypoint marker diameter in screen pixels. */
  pointSize: number;
  selectedPointSize: number;
  handleSize: number;
  /** Direction arrow length in screen pixels. */
  arrowSize: number;
  /** Bank (roll) indicator width in screen pixels. */
  bankSize: number;
  bankColor: ColorRepresentation;
  /** Label height in screen pixels. */
  labelSize: number;
  lineOpacity: number;
  /** false (default) = always drawn on top of the game scene. */
  depthTest: boolean;
  renderOrder: number;
}

export const DEFAULT_PATH_STYLE: PathRenderStyle = {
  lineColor: 0x3fa7ff,
  selectedLineColor: 0xffc933,
  pointColor: 0xffffff,
  startPointColor: 0x4cff88,
  selectedPointColor: 0xff4d6d,
  handleColor: 0xc58cff,
  arrowColor: 0x3fa7ff,
  debugColor: 0x888888,
  labelColor: '#ffffff',
  pointSize: 12,
  selectedPointSize: 17,
  handleSize: 9,
  arrowSize: 14,
  bankSize: 34,
  bankColor: 0xffc933,
  labelSize: 16,
  lineOpacity: 1,
  depthTest: false,
  renderOrder: 1000,
};

export interface ThreePathRendererOptions {
  coordinates?: CoordinateSystem;
  style?: Partial<PathRenderStyle>;
  showLine?: boolean;
  showPoints?: boolean;
  showArrows?: boolean;
  showLabels?: boolean;
  showDebug?: boolean;
  /** World distance between direction arrows. 'auto' = 12 arrows per path. */
  arrowSpacing?: number | 'auto';
  /** Line samples per curve segment. Default 32. */
  samplesPerSegment?: number;
  /**
   * Text of each waypoint label (when labels are shown). Return `null` or an
   * empty string for no label. Default: `defaultWaypointLabel`.
   */
  labelFormatter?: (context: WaypointLabelContext) => string | null;
}

export interface WaypointLabelContext {
  path: Path;
  waypoint: Waypoint;
  index: number;
}

/** Path id on the first point, then the index, plus speed ×/roll ° when set. */
export function defaultWaypointLabel({ path, waypoint, index }: WaypointLabelContext): string {
  let text = index === 0 ? `${path.name ?? path.id} · 0` : String(index);
  if (waypoint.speed !== undefined) text += ` ×${+waypoint.speed.toFixed(2)}`;
  if (waypoint.roll) text += ` ↻${+waypoint.roll.toFixed(1)}°`;
  return text;
}

/** userData stored on pickable editor objects. */
export interface PathPickData {
  pathEditor: true;
  kind: 'waypoint' | 'handle' | 'line';
  pathId: string;
  waypointIndex?: number;
  handle?: HandleKind;
}

const Z_AXIS = new Vector3(0, 0, 1);
const _bankQ = new Quaternion();
const _v = new Vector3();
const _dir = new Vector3();

/**
 * Draws one Path into its own Group: line, waypoint markers, direction arrows,
 * labels, Bezier handles and debug helpers. Owns (and disposes) every geometry,
 * material and texture it creates; never touches objects of the host scene.
 */
export class ThreePathRenderer {
  readonly group = new Group();
  readonly path: Path;
  coordinates: CoordinateSystem;
  readonly style: PathRenderStyle;
  readonly options: Required<Omit<ThreePathRendererOptions, 'coordinates' | 'style'>>;

  private selected = false;
  private selectedWaypoint: number | null = null;
  private selectedHandle: HandleKind | null = null;
  private builtVersion = -1;
  private dirty = true;

  private readonly sphere = new SphereGeometry(0.5, 16, 12);
  private readonly cone = new ConeGeometry(0.3, 1, 12).rotateX(Math.PI / 2);
  /** "Wing" bar along local X with a small up tick, for roll indicators. */
  private readonly wing = new BoxGeometry(1, 0.05, 0.05);
  private readonly orienter = new Orienter();
  private readonly materials: Record<'point' | 'start' | 'selectedPoint' | 'handle' | 'arrow' | 'bank', MeshBasicMaterial>;
  private readonly lineMaterial: LineBasicMaterial;
  private readonly auxLineMaterial: LineBasicMaterial;
  private readonly line: Line;
  private readonly pointGroup = new Group();
  private readonly arrowGroup = new Group();
  private readonly labelGroup = new Group();
  private readonly handleGroup = new Group();
  private readonly debugGroup = new Group();
  private readonly bankGroup = new Group();
  private readonly labelTextures = new Map<string, CanvasTexture>();
  /** Objects whose scale follows the camera: [object, size in px]. */
  private scaled: [Object3D, number][] = [];

  constructor(path: Path, options: ThreePathRendererOptions = {}) {
    this.path = path;
    this.coordinates = options.coordinates ?? defaultCoordinateSystem;
    this.style = { ...DEFAULT_PATH_STYLE, ...options.style };
    this.options = {
      showLine: options.showLine ?? true,
      showPoints: options.showPoints ?? true,
      showArrows: options.showArrows ?? true,
      showLabels: options.showLabels ?? false,
      showDebug: options.showDebug ?? false,
      arrowSpacing: options.arrowSpacing ?? 'auto',
      samplesPerSegment: options.samplesPerSegment ?? 32,
      labelFormatter: options.labelFormatter ?? defaultWaypointLabel,
    };
    const s = this.style;
    const mesh = (color: ColorRepresentation) =>
      new MeshBasicMaterial({ color, depthTest: s.depthTest, depthWrite: false, transparent: true });
    this.materials = {
      point: mesh(s.pointColor),
      start: mesh(s.startPointColor),
      selectedPoint: mesh(s.selectedPointColor),
      handle: mesh(s.handleColor),
      arrow: mesh(s.arrowColor),
      bank: mesh(s.bankColor),
    };
    this.lineMaterial = new LineBasicMaterial({
      color: s.lineColor,
      transparent: true,
      opacity: s.lineOpacity,
      depthTest: s.depthTest,
      depthWrite: false,
    });
    this.auxLineMaterial = new LineBasicMaterial({
      color: s.debugColor,
      transparent: true,
      opacity: 0.7,
      depthTest: s.depthTest,
      depthWrite: false,
    });
    this.line = new Line(new BufferGeometry(), this.lineMaterial);
    this.tag(this.line, { kind: 'line' });
    this.group.name = `PathEditor:path:${path.id}`;
    this.group.userData.pathEditor = true;
    this.group.add(this.debugGroup, this.line, this.arrowGroup, this.bankGroup, this.pointGroup, this.handleGroup, this.labelGroup);
  }

  setOptions(options: Partial<ThreePathRendererOptions>): void {
    for (const [key, value] of Object.entries(options)) {
      if (value === undefined) continue;
      if (key === 'coordinates') this.coordinates = value as CoordinateSystem;
      else if (key === 'style') Object.assign(this.style, value);
      else (this.options as Record<string, unknown>)[key] = value;
    }
    this.dirty = true;
  }

  setSelection(selected: boolean, waypointIndex: number | null = null, handle: HandleKind | null = null): void {
    if (this.selected === selected && this.selectedWaypoint === waypointIndex && this.selectedHandle === handle) return;
    this.selected = selected;
    this.selectedWaypoint = waypointIndex;
    this.selectedHandle = handle;
    this.dirty = true;
  }

  /** World position of waypoint `index`. */
  getWaypointWorld(index: number, target = new Vector3()): Vector3 {
    const wp = this.path.waypoints[index];
    return wp ? target.fromArray(this.coordinates.toWorld(wp.position, this.path.dimension)) : target.set(0, 0, 0);
  }

  /** World position of a Bezier handle end of waypoint `index`. */
  getHandleWorld(index: number, handle: HandleKind, target = new Vector3()): Vector3 {
    const wp = this.path.waypoints[index];
    const h = this.path.getBezierHandles(index);
    if (!wp || !h) return target.set(0, 0, 0);
    const offset = handle === 'in' ? h.handleIn : h.handleOut;
    return target.fromArray(this.coordinates.toWorld(add(wp.position, offset), this.path.dimension));
  }

  /** Objects the editor can raycast against. */
  getPickables(): { markers: Object3D[]; line: Line | null } {
    return {
      markers: [...this.handleGroup.children, ...this.pointGroup.children].filter((o) => o.userData.kind),
      line: this.line.visible ? this.line : null,
    };
  }

  /** Rebuilds if needed and keeps markers at a constant on-screen size. Call every frame. */
  update(camera?: Camera, viewportHeight = 800): void {
    if (this.dirty || this.builtVersion !== this.path.version) this.rebuild();
    if (!camera) return;
    for (const [object, px] of this.scaled) {
      object.getWorldPosition(_v);
      const s = worldUnitsPerPixel(camera, _v, viewportHeight) * px;
      if (object instanceof Sprite) {
        const aspect = (object.userData.aspect as number) ?? 1;
        object.scale.set(s * aspect, s, 1);
      } else {
        object.scale.setScalar(s);
      }
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    this.clearGroup(this.debugGroup, true);
    this.clearGroup(this.handleGroup, true);
    this.line.geometry.dispose();
    this.sphere.dispose();
    this.cone.dispose();
    this.wing.dispose();
    for (const m of Object.values(this.materials)) m.dispose();
    this.lineMaterial.dispose();
    this.auxLineMaterial.dispose();
    this.clearGroup(this.labelGroup, false);
    for (const t of this.labelTextures.values()) t.dispose();
    this.labelTextures.clear();
  }

  // ---------------------------------------------------------------- building

  private rebuild(): void {
    const { path, options, style } = this;
    this.dirty = false;
    this.builtVersion = path.version;
    this.scaled = [];
    const toWorld = (p: Vec3) => this.coordinates.toWorld(p, path.dimension);

    // Line
    this.lineMaterial.color.set(this.selected ? style.selectedLineColor : style.lineColor);
    this.setLineGeometry(this.line, path.sample(options.samplesPerSegment).map(toWorld));
    this.line.visible = options.showLine && path.waypoints.length > 1;
    this.line.userData.pathId = path.id;

    // Waypoint markers (meshes are reused, they share geometry/materials)
    const markers = this.pointGroup.children as Mesh[];
    while (markers.length > path.waypoints.length) this.pointGroup.remove(markers[markers.length - 1]);
    while (markers.length < path.waypoints.length) {
      const m = new Mesh(this.sphere, this.materials.point);
      this.pointGroup.add(m);
    }
    this.pointGroup.visible = options.showPoints;
    path.waypoints.forEach((wp, i) => {
      const m = markers[i];
      const isSelected = this.selected && this.selectedWaypoint === i;
      m.material = isSelected ? this.materials.selectedPoint : i === 0 ? this.materials.start : this.materials.point;
      m.position.fromArray(toWorld(wp.position));
      this.tag(m, { kind: 'waypoint', waypointIndex: i });
      this.scaled.push([m, isSelected ? style.selectedPointSize : style.pointSize]);
    });

    this.buildArrows(toWorld);
    this.buildBank(toWorld);
    this.buildHandles(toWorld);
    this.buildLabels(toWorld);
    this.buildDebug(toWorld);
  }

  private buildArrows(toWorld: (p: Vec3) => Vec3): void {
    const { path, options } = this;
    const length = path.length;
    let count = 0;
    if (options.showArrows && path.waypoints.length > 1 && length > 0) {
      count = options.arrowSpacing === 'auto' ? 12 : Math.floor(length / Math.max(options.arrowSpacing, 1e-6));
      count = Math.min(Math.max(count, 1), 200);
    }
    const arrows = this.arrowGroup.children as Mesh[];
    while (arrows.length > count) this.arrowGroup.remove(arrows[arrows.length - 1]);
    while (arrows.length < count) this.arrowGroup.add(this.tag(new Mesh(this.cone, this.materials.arrow), {}));
    for (let i = 0; i < count; i++) {
      const d = ((i + 0.5) / count) * length;
      const a = arrows[i];
      a.position.fromArray(toWorld(path.getPointAtDistance(d)));
      _dir.fromArray(this.coordinates.directionToWorld(path.getTangentAtDistance(d), path.dimension)).normalize();
      a.quaternion.setFromUnitVectors(Z_AXIS, _dir);
      this.scaled.push([a, this.style.arrowSize]);
    }
  }

  /** Wing bars showing the bank angle at waypoints with a roll (and the selected one). */
  private buildBank(toWorld: (p: Vec3) => Vec3): void {
    const { path } = this;
    this.bankGroup.clear();
    if (!this.options.showPoints || path.waypoints.length < 2) return;
    const distances = path.getWaypointDistances();
    path.waypoints.forEach((wp, i) => {
      const selected = this.selected && this.selectedWaypoint === i;
      if (!selected && !wp.roll) return;
      _dir.fromArray(this.coordinates.directionToWorld(path.getTangentAtDistance(distances[i]), path.dimension));
      if (!this.orienter.compute(_dir, _bankQ, ((wp.roll ?? 0) * Math.PI) / 180)) return;
      const bar = this.tag(new Mesh(this.wing, this.materials.bank), {});
      bar.position.fromArray(toWorld(wp.position));
      bar.quaternion.copy(_bankQ);
      this.bankGroup.add(bar);
      this.scaled.push([bar, this.style.bankSize]);
    });
  }

  private buildHandles(toWorld: (p: Vec3) => Vec3): void {
    this.clearGroup(this.handleGroup, true);
    const i = this.selectedWaypoint;
    if (!this.selected || i === null || this.path.curve.type !== 'bezier' || !this.options.showPoints) return;
    const wp = this.path.waypoints[i];
    const handles = this.path.getBezierHandles(i);
    if (!wp || !handles) return;
    const center = toWorld(wp.position);
    for (const kind of ['in', 'out'] as const) {
      const end = toWorld(add(wp.position, kind === 'in' ? handles.handleIn : handles.handleOut));
      const line = new Line(new BufferGeometry(), this.auxLineMaterial);
      this.setLineGeometry(line, [center, end]);
      this.handleGroup.add(this.tag(line, {}));
      const marker = new Mesh(this.sphere, this.selectedHandle === kind ? this.materials.selectedPoint : this.materials.handle);
      marker.position.fromArray(end);
      this.handleGroup.add(this.tag(marker, { kind: 'handle', waypointIndex: i, handle: kind }));
      this.scaled.push([marker, this.style.handleSize]);
    }
  }

  private buildLabels(toWorld: (p: Vec3) => Vec3): void {
    this.clearGroup(this.labelGroup, false);
    if (!this.options.showLabels || typeof document === 'undefined') return;
    const { path, style } = this;
    path.waypoints.forEach((wp, i) => {
      const text = this.options.labelFormatter({ path, waypoint: wp, index: i });
      if (!text) return;
      const sprite = this.createLabel(text);
      sprite.position.fromArray(toWorld(wp.position));
      sprite.center.set(-0.15, -0.3); // offset to the upper-right of the marker
      this.labelGroup.add(sprite);
      this.scaled.push([sprite, style.labelSize]);
    });
  }

  private buildDebug(toWorld: (p: Vec3) => Vec3): void {
    this.clearGroup(this.debugGroup, true);
    if (!this.options.showDebug || this.path.waypoints.length < 2) return;
    const pts = this.path.waypoints.map((w) => toWorld(w.position));
    if (this.path.curve.closed) pts.push(pts[0]);
    const polygon = new Line(new BufferGeometry(), this.auxLineMaterial);
    this.setLineGeometry(polygon, pts);
    this.debugGroup.add(this.tag(polygon, {}));
  }

  private createLabel(text: string): Sprite {
    let texture = this.labelTextures.get(text);
    if (!texture) {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const font = 'bold 32px system-ui, sans-serif';
      if (ctx) ctx.font = font;
      const width = Math.ceil((ctx?.measureText(text).width ?? text.length * 18) + 16);
      canvas.width = width;
      canvas.height = 44;
      if (ctx) {
        ctx.font = font;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = this.style.labelColor;
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 8, canvas.height / 2);
      }
      texture = new CanvasTexture(canvas);
      texture.userData.aspect = canvas.width / canvas.height;
      this.labelTextures.set(text, texture);
    }
    const sprite = this.tag(
      new Sprite(new SpriteMaterial({ map: texture, depthTest: this.style.depthTest, depthWrite: false, transparent: true })),
      {},
    );
    sprite.userData.aspect = texture.userData.aspect; // after tag(), which replaces userData
    return sprite;
  }

  private setLineGeometry(line: Line, points: Vec3[]): void {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(points.flat(), 3));
    line.geometry.dispose();
    line.geometry = geometry;
  }

  /** Marks an object as editor-owned, overlay-rendered and (optionally) pickable. */
  private tag<T extends Object3D>(object: T, pick: Partial<PathPickData>): T {
    object.renderOrder = this.style.renderOrder;
    object.userData = { pathEditor: true, pathId: this.path.id, ...pick } satisfies Partial<PathPickData>;
    return object;
  }

  /** Removes children; disposes their geometry (and sprite materials) when they are not shared. */
  private clearGroup(group: Group, disposeGeometry: boolean): void {
    for (const child of [...group.children]) {
      group.remove(child);
      if (disposeGeometry && child instanceof Line) child.geometry.dispose();
      if (child instanceof Sprite) (child.material as Material).dispose();
    }
  }
}
