import type { Object3D } from 'three';
import {
  readVisualsFile,
  serializeVisuals,
  stringifyVisuals,
  wornOf,
  type SubjectVisualsData,
  type VisualsFile,
} from '../core/visuals';
import { applyVisuals, forEachSetMesh, meshSetsOf } from '../runtime/VisualSets';
import { Emitter } from '../utils/Emitter';

/** An object the Visuals tab can dress, under a name the file can address. */
export interface VisualsSubject {
  id: string;
  object: Object3D;
}

export type VisualsProblemCode =
  | 'no-subjects'
  | 'no-sets'
  | 'no-file'
  | 'file-invalid'
  | 'unknown-subject'
  | 'unknown-set';

export interface VisualsProblem {
  code: VisualsProblemCode;
  message: string;
  subject?: string;
  set?: string;
}

export interface VisualsEditorOptions {
  /**
   * The objects to dress. A function is re-read on `refresh()`, for a host
   * whose cast is not built yet when the editor is created.
   *
   * `'auto'` (the default) takes them from `scene`: every named child that
   * carries more than one named mesh, by its own name. That is a starting
   * point for looking around, not a substitute for naming the objects the
   * game actually dresses.
   */
  subjects?: readonly VisualsSubject[] | (() => readonly VisualsSubject[]) | 'auto';
  /** Scanned by `subjects: 'auto'`. The panel passes the editor's scene. */
  scene?: Object3D;
  /**
   * The visuals file as the host loaded it: an object, a JSON string, or
   * `null`/`undefined` when there is none yet. Anything unreadable becomes a
   * problem in the panel, never a throw.
   */
  data?: unknown;
  /** Where that file lives, named in the panel's setup hint. */
  file?: string;
  /** The model the mesh sets come from (e.g. `Characters.glb`), likewise. */
  source?: string;
  /** The skill that sets this up, named in the setup hint. */
  skill?: string;
  /** Groups of sets that cannot be worn together, e.g. one head cover of four. */
  exclusive?: readonly (readonly string[])[];
}

export interface VisualsEditorEvents {
  change: { subject: string };
  refresh: void;
}

const DEFAULT_SKILL = 'three-path-editor-visuals';

/**
 * The Visuals tab's state: which mesh sets each subject wears, applied to the
 * live objects as they are ticked (`VisualsPanel` drives it).
 *
 * Nothing here throws. A missing file, a model whose meshes are not loaded, a
 * file naming objects or sets that are not there — each becomes an entry in
 * `problems`, and `setupHint` turns the ones that leave the tab with nothing
 * to show into the one line that says what to run. Whatever *can* be dressed
 * still is.
 */
export class VisualsEditor extends Emitter<VisualsEditorEvents> {
  private readonly options: VisualsEditorOptions;
  private readonly worn = new Map<string, Set<string>>();
  private readonly sets = new Map<string, string[]>();
  private readonly initialVisibility = new Map<Object3D, boolean>();
  private current: readonly VisualsSubject[] = [];
  private file: VisualsFile | null = null;
  private issues: VisualsProblem[] = [];

  constructor(options: VisualsEditorOptions) {
    super();
    this.options = options;
    this.refresh();
  }

  /** The file the dressing is saved to, as the host named it. */
  get fileName(): string | null {
    return this.options.file ?? null;
  }

  /** The model the mesh sets come from, from the options or the file itself. */
  get source(): string | null {
    return this.options.source ?? this.file?.source ?? null;
  }

  get skill(): string {
    return this.options.skill ?? DEFAULT_SKILL;
  }

  get subjects(): readonly VisualsSubject[] {
    return this.current;
  }

  get problems(): readonly VisualsProblem[] {
    return this.issues;
  }

  /** True when the tab has at least one subject with at least one mesh set. */
  get isUsable(): boolean {
    return this.current.some((subject) => this.setsOf(subject.id).length > 0);
  }

  /**
   * What to tell the user when the tab cannot do its job: which skill to
   * apply, which model holds the meshes and where the file belongs. `null`
   * once there is something to dress.
   */
  get setupHint(): string | null {
    if (this.isUsable && this.file) return null;
    const source = this.source;
    const file = this.fileName;
    return (
      `Apply the \`${this.skill}\` skill to set up visuals` +
      (source ? `: the mesh sets live in \`${source}\`` : ' for this project') +
      (file ? `, and the dressing belongs in \`${file}\`.` : '.')
    );
  }

  /** Re-reads the subjects and the sets they carry, keeping what is worn. */
  refresh(): void {
    this.current = safely(() => this.readSubjects(), []);
    this.issues = [];

    this.readFile();
    this.sets.clear();
    for (const subject of this.current) {
      const names = safely(() => meshSetsOf(subject.object), []);
      this.sets.set(subject.id, names);
      if (names.length === 0) {
        this.report({
          code: 'no-sets',
          subject: subject.id,
          message: `"${subject.id}" carries no named meshes to dress it with.`,
        });
        continue;
      }
      this.rememberVisibility(subject.object);
      this.seedWorn(subject, names);
    }

    if (this.current.length === 0) {
      this.report({
        code: 'no-subjects',
        message:
          this.options.subjects === undefined || this.options.subjects === 'auto'
            ? 'Nothing in the scene carries more than one named mesh, and no objects were configured.'
            : 'No objects were handed to the Visuals tab.',
      });
    }
    this.reportUnknownSubjects();
    this.applyAll();
    this.emit('refresh', undefined);
  }

  /** The mesh sets `id` carries, worn or not. */
  setsOf(id: string): readonly string[] {
    return this.sets.get(id) ?? [];
  }

  isWorn(id: string, set: string): boolean {
    return this.worn.get(id)?.has(set) ?? false;
  }

  setWorn(id: string, set: string, worn: boolean): void {
    const current = this.worn.get(id);
    if (!current || !this.setsOf(id).includes(set)) return;
    if (worn) {
      current.add(set);
      for (const other of this.exclusiveWith(set)) current.delete(other);
    } else {
      current.delete(set);
    }
    this.apply(id);
    this.emit('change', { subject: id });
  }

  /** Back to what the file (or the model itself) started with. */
  reset(): void {
    this.refresh();
  }

  /** The dressing as the visuals file, ready for `onSave` or the clipboard. */
  exportString(indent = 2): string {
    return stringifyVisuals(this.toData(), indent, { source: this.source, extras: this.file?.extras });
  }

  toData(): SubjectVisualsData[] {
    return this.current.map((subject) => ({
      ...(this.file?.subjects.find((entry) => entry.id === subject.id) ?? {}),
      id: subject.id,
      worn: this.setsOf(subject.id).filter((set) => this.isWorn(subject.id, set)),
    }));
  }

  toJSON(): ReturnType<typeof serializeVisuals> {
    return serializeVisuals(this.toData(), { source: this.source, extras: this.file?.extras });
  }

  /** Puts every subject's meshes back the way the host had them. */
  restore(): void {
    for (const [mesh, visible] of this.initialVisibility) mesh.visible = visible;
    this.initialVisibility.clear();
  }

  dispose(): void {
    this.restore();
    this.clear();
  }

  private readSubjects(): readonly VisualsSubject[] {
    const { subjects, scene } = this.options;
    if (typeof subjects === 'function') return subjects();
    if (Array.isArray(subjects)) return subjects;
    return scene ? autoSubjects(scene) : [];
  }

  private readFile(): void {
    const { data } = this.options;
    this.file = null;
    if (data === undefined || data === null || data === '') {
      this.report({
        code: 'no-file',
        message: this.fileName ? `No visuals file at ${this.fileName} yet.` : 'No visuals file was loaded.',
      });
      return;
    }
    try {
      this.file = readVisualsFile(data);
    } catch (err) {
      this.report({ code: 'file-invalid', message: (err as Error).message });
    }
  }

  // A subject with no entry in the file keeps what the model itself draws, so
  // a cast that grows does not come up naked.
  private seedWorn(subject: VisualsSubject, names: readonly string[]): void {
    const saved = this.file ? wornOf(this.file, subject.id) : null;
    if (!saved) {
      this.worn.set(subject.id, new Set(names.filter((name) => this.isDrawn(subject.object, name))));
      return;
    }

    const known = saved.filter((name) => {
      if (names.includes(name)) return true;
      this.report({
        code: 'unknown-set',
        subject: subject.id,
        set: name,
        message: `"${subject.id}" has no mesh set "${name}" — the file is older than the model.`,
      });
      return false;
    });
    this.worn.set(subject.id, new Set(known));
  }

  private reportUnknownSubjects(): void {
    if (!this.file) return;
    for (const entry of this.file.subjects) {
      if (this.current.some((subject) => subject.id === entry.id)) continue;
      this.report({
        code: 'unknown-subject',
        subject: entry.id,
        message: `The file dresses "${entry.id}", which is not in the scene.`,
      });
    }
  }

  private isDrawn(object: Object3D, name: string): boolean {
    let drawn = false;
    forEachSetMesh(object, (mesh) => {
      if (mesh.name === name && mesh.visible) drawn = true;
    });
    return drawn;
  }

  private rememberVisibility(object: Object3D): void {
    forEachSetMesh(object, (mesh) => {
      if (!this.initialVisibility.has(mesh)) this.initialVisibility.set(mesh, mesh.visible);
    });
  }

  private exclusiveWith(set: string): string[] {
    const groups = this.options.exclusive ?? [];
    return groups.filter((group) => group.includes(set)).flatMap((group) => group.filter((name) => name !== set));
  }

  private applyAll(): void {
    for (const subject of this.current) this.apply(subject.id);
  }

  private apply(id: string): void {
    const subject = this.current.find((entry) => entry.id === id);
    const worn = this.worn.get(id);
    if (!subject || !worn) return;
    safely(() => applyVisuals(subject.object, worn), null);
  }

  private report(problem: VisualsProblem): void {
    this.issues.push(problem);
  }
}

/**
 * What a scene offers to dress with no configuration: named children that
 * carry more than one named mesh. One mesh is a prop, not a wardrobe.
 */
export function autoSubjects(scene: Object3D): VisualsSubject[] {
  return scene.children
    .filter((child) => child.name !== '' && child.userData.pathEditor !== true)
    .map((object) => ({ id: object.name, object }))
    .filter((subject) => meshSetsOf(subject.object).length > 1);
}

/** The tab reports what went wrong instead of taking the editor down with it. */
function safely<T>(run: () => T, fallback: T): T {
  try {
    return run();
  } catch {
    return fallback;
  }
}
