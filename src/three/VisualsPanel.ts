import type { PathEditorPanelTab } from './PathEditorPanel';
import type { VisualsEditor, VisualsProblem } from './VisualsEditor';

export interface VisualsPanelOptions {
  /** Tab label. Default 'Visuals'. */
  label?: string;
  /** File name used by the Export button. Default the editor's `file`, else 'visuals.json'. */
  fileName?: string;
  /** Replace the default "download file" export behaviour. */
  onExport?: (json: string) => void;
  /**
   * Shows a Save button that hands the visuals JSON to this function, e.g.
   * `(json) => saveToDevServer(json, { endpoint: VISUALS_SAVE_ENDPOINT })`.
   */
  onSave?: (json: string) => unknown;
}

const STYLE_ID = 'three-path-editor-visuals-style';
const CSS = `
.tpe-visuals details{margin:2px 0}
.tpe-visuals summary{cursor:pointer;color:#cdd6e4;padding:2px 0}
.tpe-visuals .tpe-sets{padding:2px 0 4px 12px}
.tpe-visuals .tpe-sets label{display:block;font-family:ui-monospace,monospace;font-size:11px}
.tpe-visuals .tpe-note{border:1px solid #7a5a2a;background:#3a2e18;border-radius:4px;padding:6px 8px;margin-bottom:6px;color:#f0d9a8}
.tpe-visuals .tpe-note code{background:rgba(0,0,0,.3);border-radius:3px;padding:0 3px}
.tpe-visuals .tpe-note ul{margin:4px 0 0;padding-left:16px}
.tpe-visuals .tpe-note li{margin:1px 0}
`;

/**
 * The editor's Visuals tab: draws the mesh sets each subject carries as
 * checkboxes and dresses the live objects as they are ticked.
 *
 * When the tab has nothing to work with — no visuals file yet, no objects, a
 * model whose meshes never arrived — it says so here, in the tab itself,
 * together with the one line that fixes it: which skill to apply and which
 * model file the mesh sets live in. The editor keeps running either way.
 */
export class VisualsPanel {
  readonly element: HTMLElement;
  private readonly editor: VisualsEditor;
  private readonly options: VisualsPanelOptions;
  private readonly unsubscribers: (() => void)[] = [];
  private statusText = '';

  constructor(editor: VisualsEditor, options: VisualsPanelOptions = {}) {
    this.editor = editor;
    this.options = options;
    injectStyle();

    const element = (this.element = document.createElement('div'));
    element.className = 'tpe-visuals';
    // The tab lives inside the path panel, whose own delegated handlers read
    // `data-act` / `data-el`: this panel's input is its own.
    for (const type of ['pointerdown', 'wheel', 'keydown', 'click', 'change'] as const) {
      element.addEventListener(type, (event) => event.stopPropagation());
    }
    this.unsubscribers.push(editor.on('refresh', () => this.refresh()));
    this.refresh();
  }

  /** Ready to hand to `PathEditorPanel.addTab`. */
  get tab(): PathEditorPanelTab {
    return { label: this.options.label ?? 'Visuals', element: this.element };
  }

  refresh(): void {
    this.element.replaceChildren(
      ...this.renderNote(),
      ...this.editor.subjects.map((subject) => this.renderSubject(subject.id)),
      this.renderActions(),
    );
  }

  dispose(): void {
    for (const off of this.unsubscribers) off();
    this.element.remove();
  }

  private renderNote(): HTMLElement[] {
    const problems = this.editor.problems;
    const hint = this.editor.setupHint;
    if (problems.length === 0 && !hint) return [];

    const section = document.createElement('section');
    const note = document.createElement('div');
    note.className = 'tpe-note';
    if (hint) note.appendChild(markup(hint));
    if (problems.length > 0) note.appendChild(this.renderProblems(problems));
    section.appendChild(note);
    return [section];
  }

  private renderProblems(problems: readonly VisualsProblem[]): HTMLElement {
    const list = document.createElement('ul');
    for (const problem of problems) {
      const item = document.createElement('li');
      item.textContent = problem.message;
      list.appendChild(item);
    }
    return list;
  }

  private renderSubject(id: string): HTMLElement {
    const section = document.createElement('section');
    const sets = this.editor.setsOf(id);
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = `${id} (${sets.length})`;
    details.appendChild(summary);

    const box = document.createElement('div');
    box.className = 'tpe-sets';
    for (const set of sets) {
      box.appendChild(this.renderSet(id, set));
    }
    if (sets.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'tpe-hint';
      empty.textContent = 'No named meshes on this object.';
      box.appendChild(empty);
    }
    details.appendChild(box);
    section.appendChild(details);
    return section;
  }

  private renderSet(id: string, set: string): HTMLElement {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = this.editor.isWorn(id, set);
    input.addEventListener('change', () => {
      this.editor.setWorn(id, set, input.checked);
      // An exclusive group may have taken something else off.
      this.syncChecks();
    });
    label.appendChild(input);
    label.appendChild(document.createTextNode(` ${set}`));
    label.dataset.subject = id;
    label.dataset.set = set;
    return label;
  }

  private syncChecks(): void {
    for (const label of this.element.querySelectorAll<HTMLLabelElement>('label[data-set]')) {
      const input = label.firstElementChild as HTMLInputElement | null;
      const { subject, set } = label.dataset;
      if (input && subject && set) input.checked = this.editor.isWorn(subject, set);
    }
  }

  private renderActions(): HTMLElement {
    const section = document.createElement('section');
    const row = document.createElement('div');
    row.className = 'tpe-row';
    if (this.options.onSave) row.appendChild(this.button('Save', () => this.save()));
    row.appendChild(this.button('Export', () => this.export()));
    row.appendChild(this.button('Copy', () => this.copy()));
    row.appendChild(this.button('Reset', () => this.editor.reset()));
    section.appendChild(row);

    const status = document.createElement('div');
    status.className = 'tpe-status';
    status.textContent = this.statusText;
    status.dataset.el = 'visuals-status';
    section.appendChild(status);
    return section;
  }

  private button(text: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.addEventListener('click', onClick);
    return button;
  }

  private save(): void {
    const save = this.options.onSave;
    if (!save) return;
    this.status('Saving…');
    Promise.resolve()
      .then(() => save(this.editor.exportString()))
      .then(() => this.status('Saved.'))
      .catch((err: unknown) => this.status(`Save failed: ${err instanceof Error ? err.message : String(err)}`));
  }

  private export(): void {
    const json = this.editor.exportString();
    if (this.options.onExport) this.options.onExport(json);
    else download(json, this.options.fileName ?? baseName(this.editor.fileName) ?? 'visuals.json');
    this.status('Exported.');
  }

  private copy(): void {
    navigator.clipboard
      ?.writeText(this.editor.exportString())
      .then(() => this.status('JSON copied to clipboard.'))
      .catch(() => this.status('Clipboard not available.'));
  }

  private status(text: string): void {
    this.statusText = text;
    const status = this.element.querySelector('[data-el="visuals-status"]');
    if (status) status.textContent = text;
  }
}

/** Renders the hint's `backtick` spans as code, with no HTML from the host. */
function markup(text: string): HTMLElement {
  const line = document.createElement('div');
  text.split('`').forEach((part, index) => {
    if (index % 2 === 0) {
      line.appendChild(document.createTextNode(part));
      return;
    }
    const code = document.createElement('code');
    code.textContent = part;
    line.appendChild(code);
  });
  return line;
}

function baseName(file: string | null): string | null {
  return file ? file.slice(file.lastIndexOf('/') + 1) : null;
}

function download(json: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function injectStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}
