import { Path } from '../core/Path';
import type { PathData } from '../core/types';
import { Emitter } from '../utils/Emitter';
import type { EditorSelection, EditorState } from './EditorState';

interface Snapshot {
  paths: { path: Path; data: PathData }[];
  key: string;
}

interface HistoryEntry {
  before: Snapshot;
  after: Snapshot;
  selectionBefore: EditorSelection;
  selectionAfter: EditorSelection;
}

export interface EditorHistoryEvents {
  change: { canUndo: boolean; canRedo: boolean };
}

export interface EditorHistoryOptions {
  /** Maximum number of undo steps. Default 100. */
  limit?: number;
}

/**
 * Snapshot-based undo/redo for an EditorState. Three.js-independent.
 *
 * - All changes made in the same synchronous task become one step
 *   (e.g. an insert that also adjusts Bezier handles).
 * - `begin()` / `end()` group longer interactions (a gizmo drag) into one step.
 * - Restoring reuses the original Path objects, so external references
 *   (followers, previews) stay valid even for deleted-then-restored paths.
 */
export class EditorHistory {
  readonly events = new Emitter<EditorHistoryEvents>();
  limit: number;
  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];
  private current: Snapshot;
  private pending = false;
  private depth = 0;
  private restoring = false;
  private batchSelection: EditorSelection | null = null;
  private readonly unsubscribers: (() => void)[];

  constructor(private readonly state: EditorState, options: EditorHistoryOptions = {}) {
    this.limit = options.limit ?? 100;
    this.current = this.capture();
    const onChange = () => this.onChange();
    this.unsubscribers = [state.events.on('pathchange', onChange), state.events.on('paths', onChange)];
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0 || (this.depth === 0 && this.hasUncommittedChanges());
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Starts grouping every change until the matching `end()` into one step. Nestable. */
  begin(): void {
    if (this.depth++ === 0) {
      this.commit();
      this.batchSelection = { ...this.state.selection };
    }
  }

  end(): void {
    if (this.depth === 0) return;
    if (--this.depth === 0) this.commit();
  }

  /** Records pending changes now instead of at the end of the current task. */
  flush(): void {
    if (this.depth === 0) this.commit();
  }

  undo(): boolean {
    this.flush();
    const entry = this.undoStack.pop();
    if (!entry) return false;
    this.restore(entry.before, entry.selectionBefore);
    this.redoStack.push(entry);
    this.emit();
    return true;
  }

  redo(): boolean {
    this.flush();
    const entry = this.redoStack.pop();
    if (!entry) return false;
    this.restore(entry.after, entry.selectionAfter);
    this.undoStack.push(entry);
    this.emit();
    return true;
  }

  /** Forgets all steps; the current state becomes the new baseline. */
  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.batchSelection = null;
    this.current = this.capture();
    this.emit();
  }

  dispose(): void {
    for (const off of this.unsubscribers) off();
    this.events.clear();
  }

  private onChange(): void {
    if (this.restoring) return;
    if (!this.batchSelection) this.batchSelection = { ...this.state.selection };
    if (this.depth > 0 || this.pending) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      if (this.depth === 0) this.commit();
    });
  }

  private commit(): void {
    const selectionBefore = this.batchSelection ?? { ...this.state.selection };
    this.batchSelection = null;
    const next = this.capture();
    if (next.key === this.current.key) return;
    this.undoStack.push({ before: this.current, after: next, selectionBefore, selectionAfter: { ...this.state.selection } });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this.current = next;
    this.emit();
  }

  private restore(snapshot: Snapshot, selection: EditorSelection): void {
    this.restoring = true;
    try {
      // Content first (ids may change), then the set/order of paths.
      const paths = snapshot.paths.map(({ path, data }) => {
        if (path.dimension !== data.dimension) return Path.fromJSON(data);
        if (JSON.stringify(path.toJSON()) !== JSON.stringify(data)) path.setData(data);
        return path;
      });
      this.state.replacePaths(paths);
      this.state.select(selection.pathId, selection.waypointIndex, selection.handle);
      this.current = this.capture();
    } finally {
      this.restoring = false;
    }
  }

  private hasUncommittedChanges(): boolean {
    return this.pending && this.capture().key !== this.current.key;
  }

  private capture(): Snapshot {
    const paths = this.state.paths.map((path) => ({ path, data: path.toJSON() }));
    return { paths, key: JSON.stringify(paths.map((p) => p.data)) };
  }

  private emit(): void {
    this.events.emit('change', { canUndo: this.canUndo, canRedo: this.canRedo });
  }
}
