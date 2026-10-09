import type { Path } from '../core/Path';
import { Emitter } from '../utils/Emitter';

export interface EditorViewOptions {
  /** TransformControls gizmo on the selected waypoint. */
  gizmos: boolean;
  /** Path lines and waypoint markers. */
  paths: boolean;
  /** Direction arrows along paths. */
  directions: boolean;
  /** Waypoint index / path name labels. */
  labels: boolean;
  /** Facing arrows on waypoints that carry a `yaw`. */
  facings: boolean;
  /** Sight lines of camera rigs (camera path ↔ what it looks at). */
  sightlines: boolean;
  /** Warning ticks where a path runs below the surface it was authored on. */
  surface: boolean;
  /** Editor grid + axes helpers. */
  grid: boolean;
  /** Control polygon and other debug helpers. */
  debug: boolean;
}

export const DEFAULT_VIEW: EditorViewOptions = {
  gizmos: true,
  paths: true,
  directions: true,
  labels: false,
  facings: true,
  sightlines: true,
  surface: true,
  grid: false,
  debug: false,
};

export type HandleKind = 'in' | 'out';

export interface EditorSelection {
  pathId: string | null;
  waypointIndex: number | null;
  /** Selected Bezier handle of the selected waypoint. */
  handle: HandleKind | null;
}

export interface EditorStateEvents {
  selection: EditorSelection;
  view: EditorViewOptions;
  /** The set of paths changed (added, removed, replaced, renamed). */
  paths: Path[];
  /** A path's content changed. */
  pathchange: Path;
}

/**
 * Three.js-independent editor state: the loaded paths, the selection and the
 * view toggles. The Three.js editor renders whatever this state says.
 */
export class EditorState {
  readonly events = new Emitter<EditorStateEvents>();
  readonly view: EditorViewOptions;
  private readonly _paths = new Map<string, Path>();
  private readonly unsubscribers = new Map<Path, () => void>();
  private _selection: EditorSelection = { pathId: null, waypointIndex: null, handle: null };

  constructor(view: Partial<EditorViewOptions> = {}) {
    this.view = { ...DEFAULT_VIEW, ...view };
  }

  get paths(): Path[] {
    return [...this._paths.values()];
  }

  get selection(): Readonly<EditorSelection> {
    return this._selection;
  }

  get selectedPath(): Path | null {
    return this._selection.pathId ? this._paths.get(this._selection.pathId) ?? null : null;
  }

  getPath(id: string): Path | undefined {
    return this._paths.get(id);
  }

  hasPath(id: string): boolean {
    return this._paths.has(id);
  }

  /** Adds a path, replacing any existing path with the same id. */
  addPath(path: Path): void {
    const existing = this._paths.get(path.id);
    if (existing === path) return;
    if (existing) this.detach(existing);
    this._paths.set(path.id, path);
    this.attach(path);
    this.events.emit('paths', this.paths);
    this.clampSelection();
  }

  /** Replaces the whole set of paths (in this order) with a single 'paths' event. Used by undo/redo. */
  replacePaths(paths: Path[]): void {
    const keep = new Set(paths);
    const previous = new Set(this._paths.values());
    for (const path of previous) if (!keep.has(path)) this.detach(path);
    this._paths.clear();
    for (const path of paths) {
      this._paths.set(path.id, path);
      if (!previous.has(path)) this.attach(path);
    }
    this.events.emit('paths', this.paths);
    this.clampSelection();
  }

  removePath(id: string): Path | undefined {
    const path = this._paths.get(id);
    if (!path) return undefined;
    this.detach(path);
    this._paths.delete(id);
    if (this._selection.pathId === id) this.select(null);
    this.events.emit('paths', this.paths);
    return path;
  }

  /** Removes all paths. */
  clear(): void {
    for (const path of this._paths.values()) this.detach(path);
    this._paths.clear();
    this.select(null);
    this.events.emit('paths', []);
  }

  renamePath(oldId: string, newId: string): boolean {
    const path = this._paths.get(oldId);
    if (!path || !newId || (newId !== oldId && this._paths.has(newId))) return false;
    if (newId === oldId) return true;
    // Rebuild the map to keep insertion order.
    const entries = [...this._paths.entries()].map(([id, p]) => [id === oldId ? newId : id, p] as const);
    this._paths.clear();
    for (const [id, p] of entries) this._paths.set(id, p);
    path.id = newId;
    if (this._selection.pathId === oldId) this._selection = { ...this._selection, pathId: newId };
    this.events.emit('paths', this.paths);
    path.markChanged();
    return true;
  }

  select(pathId: string | null, waypointIndex: number | null = null, handle: HandleKind | null = null): void {
    const path = pathId ? this._paths.get(pathId) : undefined;
    const next: EditorSelection = path
      ? {
          pathId: path.id,
          waypointIndex: waypointIndex !== null && waypointIndex >= 0 && waypointIndex < path.waypoints.length ? waypointIndex : null,
          handle: null,
        }
      : { pathId: null, waypointIndex: null, handle: null };
    if (next.waypointIndex !== null) next.handle = handle;
    const cur = this._selection;
    if (cur.pathId === next.pathId && cur.waypointIndex === next.waypointIndex && cur.handle === next.handle) return;
    this._selection = next;
    this.events.emit('selection', next);
  }

  setView(options: Partial<EditorViewOptions>): void {
    let changed = false;
    for (const key of Object.keys(options) as (keyof EditorViewOptions)[]) {
      const value = options[key];
      if (typeof value === 'boolean' && this.view[key] !== value) {
        this.view[key] = value;
        changed = true;
      }
    }
    if (changed) this.events.emit('view', { ...this.view });
  }

  toggleView(key: keyof EditorViewOptions): boolean {
    this.setView({ [key]: !this.view[key] });
    return this.view[key];
  }

  private attach(path: Path): void {
    this.unsubscribers.set(
      path,
      path.events.on('change', () => {
        // Announce first (listeners such as history see the pre-change selection), then fix the selection.
        this.events.emit('pathchange', path);
        this.clampSelection();
      }),
    );
  }

  private detach(path: Path): void {
    this.unsubscribers.get(path)?.();
    this.unsubscribers.delete(path);
  }

  /** Keeps the selection valid after waypoints were removed. */
  private clampSelection(): void {
    const { pathId, waypointIndex, handle } = this._selection;
    const path = this.selectedPath;
    if (!path) {
      if (pathId) this.select(null);
      return;
    }
    if (waypointIndex !== null && waypointIndex >= path.waypoints.length) {
      this.select(path.id, path.waypoints.length ? path.waypoints.length - 1 : null, handle);
    }
  }
}
