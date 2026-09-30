import type { LoopMode } from '../core/PathCursor';
import type { CatmullRomParametrization, CurveType, Metadata } from '../core/types';
import type { EditorViewOptions } from '../editor/EditorState';
import { EDITOR_UI_ATTRIBUTE, type EditorAction, type PathEditor } from './PathEditor';
import type { WaypointLabelContext } from './ThreePathRenderer';

export interface PathEditorPanelOptions {
  /** Where to mount the panel. Default `document.body`. */
  container?: HTMLElement;
  /** Corner of the container. Default 'top-right'. */
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
  title?: string;
  /** File name used by the Export button. Default 'paths.json'. */
  fileName?: string;
  /** Replace the default "download file" export behaviour. */
  onExport?: (json: string) => void;
  /**
   * Shows a Save button that hands the exported JSON to this function, e.g.
   * `(json) => saveToDevServer(json)`. A returned promise drives the status
   * line ("Saving…", "Saved.", or the rejection message).
   */
  onSave?: (json: string) => unknown;
  collapsed?: boolean;
  /** Ask before deleting a path. Default true. */
  confirmDelete?: boolean;
  /** Extra text after `#i x, y, z` in the waypoint list (e.g. a name from metadata). */
  formatWaypoint?: (context: WaypointLabelContext) => string | null;
}

const VIEW_LABELS: [keyof EditorViewOptions, string][] = [
  ['gizmos', 'Gizmos'],
  ['paths', 'Paths'],
  ['directions', 'Arrows'],
  ['labels', 'Labels'],
  ['grid', 'Grid'],
  ['debug', 'Debug'],
];

const STYLE_ID = 'three-path-editor-panel-style';
const CSS = `
.tpe-panel{position:absolute;z-index:10000;width:280px;max-height:calc(100% - 20px);overflow:auto;background:rgba(18,22,30,.92);color:#e6e9ef;font:12px/1.4 system-ui,sans-serif;border:1px solid #2c3442;border-radius:8px;box-shadow:0 4px 18px rgba(0,0,0,.4);user-select:none}
.tpe-panel.top-right{top:10px;right:10px}.tpe-panel.top-left{top:10px;left:10px}.tpe-panel.bottom-right{bottom:10px;right:10px}.tpe-panel.bottom-left{bottom:10px;left:10px}
.tpe-panel header{display:flex;align-items:center;justify-content:space-between;padding:6px 10px;border-bottom:1px solid #2c3442;font-weight:600;cursor:pointer}
.tpe-panel.collapsed .tpe-body{display:none}
.tpe-panel section{padding:8px 10px;border-bottom:1px solid #232a36}
.tpe-panel h4{margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#8b95a7}
.tpe-row{display:flex;gap:4px;align-items:center;margin:4px 0;flex-wrap:wrap}
.tpe-panel button,.tpe-panel select,.tpe-panel input{font:inherit;color:inherit;background:#252d3a;border:1px solid #364052;border-radius:4px;padding:2px 6px}
.tpe-panel button{cursor:pointer}.tpe-panel button:hover{background:#2f3a4b}.tpe-panel button:disabled{opacity:.4;cursor:default}
.tpe-panel input[type=number]{width:62px}.tpe-panel input[type=text]{flex:1;min-width:0}.tpe-panel select{flex:1;min-width:0}
.tpe-panel label{display:inline-flex;align-items:center;gap:3px}
.tpe-points{max-height:140px;overflow:auto;border:1px solid #2c3442;border-radius:4px}
.tpe-points div{padding:2px 6px;cursor:pointer;font-family:ui-monospace,monospace;font-size:11px;white-space:nowrap}
.tpe-points div:hover{background:#252d3a}.tpe-points div.sel{background:#5a2330}
.tpe-panel button.tpe-danger{border-color:#7a2a36;color:#ff9aa8}.tpe-panel button.tpe-danger:hover{background:#4a1c24}
.tpe-panel input[data-el=speed-wp],.tpe-panel input[data-el=roll]{width:54px}
.tpe-panel textarea{font:11px/1.35 ui-monospace,monospace;color:inherit;background:#252d3a;border:1px solid #364052;border-radius:4px;padding:3px 5px;width:100%;box-sizing:border-box;min-height:44px;resize:vertical}
.tpe-panel textarea.tpe-invalid{border-color:#b04454}
.tpe-hint{color:#8b95a7;font-size:11px}.tpe-status{color:#9fd49f;min-height:14px}
`;

/**
 * Optional, dependency-free DOM panel for the editor: path list, curve
 * settings, waypoint list/coordinates, view toggles, preview and JSON I/O.
 * Games that have their own dev UI can skip it and call the PathEditor API.
 */
export class PathEditorPanel {
  readonly element: HTMLDivElement;
  private readonly editor: PathEditor;
  private readonly options: PathEditorPanelOptions;
  private readonly unsubscribers: (() => void)[] = [];
  private frame = 0;

  constructor(editor: PathEditor, options: PathEditorPanelOptions = {}) {
    this.editor = editor;
    this.options = options;
    injectStyle();
    const el = (this.element = document.createElement('div'));
    el.className = `tpe-panel ${options.position ?? 'top-right'}${options.collapsed ? ' collapsed' : ''}`;
    el.setAttribute(EDITOR_UI_ATTRIBUTE, '');
    el.innerHTML = this.template();
    const container = options.container ?? document.body;
    if (container !== document.body && getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }
    container.appendChild(el);
    // Keep panel input away from the game / canvas handlers.
    for (const type of ['pointerdown', 'wheel', 'keydown'] as const) el.addEventListener(type, (e) => e.stopPropagation());
    el.addEventListener('click', this.onClick);
    el.addEventListener('change', this.onChange);

    for (const type of ['change', 'select', 'view', 'pathadded', 'pathremoved', 'preview', 'previewstate', 'enabled', 'history'] as const) {
      this.unsubscribers.push(editor.on(type, () => this.scheduleRefresh()));
    }
    this.refresh();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    for (const off of this.unsubscribers) off();
    this.element.remove();
  }

  private $<T extends HTMLElement>(name: string): T {
    return this.element.querySelector(`[data-el="${name}"]`) as T;
  }

  private scheduleRefresh(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.refresh();
    });
  }

  /** Syncs every control with the editor state. */
  refresh(): void {
    const editor = this.editor;
    const path = editor.selectedPath;
    const index = editor.selection.waypointIndex;

    this.$<HTMLButtonElement>('enabled').textContent = editor.enabled ? 'Editor: ON' : 'Editor: OFF';
    this.$<HTMLButtonElement>('undo').disabled = !editor.canUndo;
    this.$<HTMLButtonElement>('redo').disabled = !editor.canRedo;

    const pathSelect = this.$<HTMLSelectElement>('path');
    pathSelect.innerHTML =
      `<option value="">— none —</option>` +
      editor.paths.map((p) => `<option value="${esc(p.id)}">${esc(p.id)} (${p.dimension}D)</option>`).join('');
    pathSelect.value = path?.id ?? '';

    const denied = (action: EditorAction, waypointIndex: number | null = null) =>
      !path || !editor.can(action, path, waypointIndex);
    (this.$('preview') as HTMLButtonElement).disabled = !path;
    (this.$('pathId') as HTMLInputElement).disabled = denied('renamePath');
    (this.$('delpath') as HTMLButtonElement).disabled = denied('deletePath');
    (this.$('add') as HTMLButtonElement).disabled = denied('addWaypoint');
    for (const name of ['curve', 'closed', 'tension', 'reverse']) (this.$(name) as HTMLInputElement).disabled = denied('editCurve');
    const param = this.$<HTMLSelectElement>('param');
    param.disabled = denied('editCurve') || path?.curve.type !== 'catmull-rom';
    param.value = path?.curve.parametrization ?? 'uniform';
    setValue(this.$<HTMLInputElement>('pathId'), path?.id ?? '');
    this.$<HTMLSelectElement>('curve').value = path?.curve.type ?? 'catmull-rom';
    this.$<HTMLInputElement>('closed').checked = path?.curve.closed ?? false;
    setValue(this.$<HTMLInputElement>('tension'), path ? String(path.curve.tension) : '');

    // Waypoint list
    this.$('count').textContent = path ? `(${path.waypoints.length}, ${path.length.toFixed(1)} u)` : '';
    this.$('points').innerHTML = path
      ? path.waypoints
          .map(
            (w, i) =>
              `<div data-idx="${i}" class="${i === index ? 'sel' : ''}">#${i}  ${w.position
                .slice(0, path.dimension)
                .map((v) => v.toFixed(2))
                .join(', ')}${this.waypointSuffix(path, i)}</div>`,
          )
          .join('')
      : '';

    const wp = path && index !== null ? path.waypoints[index] : null;
    (['x', 'y', 'z'] as const).forEach((axis, c) => {
      const input = this.$<HTMLInputElement>(axis);
      input.disabled = !wp || (c === 2 && path?.dimension === 2) || denied('moveWaypoint', index);
      setValue(input, wp && !(c === 2 && path?.dimension === 2) ? String(round(wp.position[c])) : '');
    });
    (this.$('del') as HTMLButtonElement).disabled = !wp || denied('deleteWaypoint', index);
    for (const name of ['up', 'down']) (this.$(name) as HTMLButtonElement).disabled = !wp || denied('reorderWaypoint', index);
    const speedInput = this.$<HTMLInputElement>('speed-wp');
    const rollInput = this.$<HTMLInputElement>('roll');
    speedInput.disabled = rollInput.disabled = !wp || denied('editWaypointProperties', index);
    setValue(speedInput, wp?.speed !== undefined ? String(round(wp.speed)) : '');
    setValue(rollInput, wp?.roll !== undefined ? String(round(wp.roll)) : '');

    const pointMeta = this.$<HTMLTextAreaElement>('meta-wp');
    pointMeta.disabled = !wp || denied('editMetadata', index);
    setValue(pointMeta, wp ? stringifyMetadata(wp.metadata) : '');
    const pathMeta = this.$<HTMLTextAreaElement>('meta-path');
    pathMeta.disabled = denied('editMetadata');
    setValue(pathMeta, path ? stringifyMetadata(path.metadata) : '');
    if (document.activeElement !== pointMeta) pointMeta.classList.remove('tpe-invalid');
    if (document.activeElement !== pathMeta) pathMeta.classList.remove('tpe-invalid');

    // View
    for (const [key] of VIEW_LABELS) this.$<HTMLInputElement>(`view-${key}`).checked = editor.view[key];

    // Preview
    const preview = editor.preview;
    this.$<HTMLButtonElement>('play').disabled = !preview;
    this.$<HTMLButtonElement>('reset').disabled = !preview;
    this.$<HTMLButtonElement>('stop').disabled = !preview;
    this.$<HTMLButtonElement>('play').textContent = preview?.isPlaying ? 'Pause' : 'Play';
    setValue(this.$<HTMLInputElement>('speed'), preview ? String(round(preview.speed)) : '');
    this.$<HTMLSelectElement>('loop').value = preview?.loop ?? 'loop';
  }

  private waypointSuffix(path: NonNullable<PathEditor['selectedPath']>, index: number): string {
    const text = this.options.formatWaypoint?.({ path, waypoint: path.waypoints[index], index });
    return text ? `  ${esc(text)}` : '';
  }

  private status(text: string): void {
    this.$('status').textContent = text;
  }

  private readonly onClick = (e: MouseEvent): void => {
    const target = e.target as HTMLElement;
    const editor = this.editor;
    const path = editor.selectedPath;
    const row = target.closest('[data-idx]') as HTMLElement | null;
    if (row && path) {
      editor.select(path.id, Number(row.dataset.idx));
      return;
    }
    switch (target.closest('[data-act]')?.getAttribute('data-act')) {
      case 'collapse':
        this.element.classList.toggle('collapsed');
        break;
      case 'enabled':
        editor.toggle();
        break;
      case 'undo':
        editor.undo();
        break;
      case 'redo':
        editor.redo();
        break;
      case 'new3d':
        editor.createPathInView({ dimension: 3, id: uniqueId(editor, 'route') });
        break;
      case 'new2d':
        editor.createPathInView({ dimension: 2, id: uniqueId(editor, 'route2d') });
        break;
      case 'delpath':
        if (!path) break;
        if ((this.options.confirmDelete ?? true) && !confirm(`Delete path "${path.id}"? This cannot be undone.`)) break;
        editor.removePath(path.id);
        this.status(`Deleted path "${path.id}".`);
        break;
      case 'reverse':
        if (path && editor.can('editCurve', path)) path.reverse();
        break;
      case 'add':
        editor.addWaypoint();
        break;
      case 'del':
        editor.deleteSelectedWaypoint();
        break;
      case 'up':
        editor.shiftSelectedWaypoint(-1);
        break;
      case 'down':
        editor.shiftSelectedWaypoint(1);
        break;
      case 'preview':
        if (path) editor.previewPath(path);
        break;
      case 'play':
        editor.preview?.toggle();
        this.refresh();
        break;
      case 'reset':
        editor.preview?.reset();
        break;
      case 'stop':
        editor.detachPreview();
        break;
      case 'save': {
        const save = this.options.onSave;
        if (!save) break;
        this.status('Saving…');
        Promise.resolve()
          .then(() => save(editor.exportString()))
          .then(() => this.status(`Saved ${editor.paths.length} path(s).`))
          .catch((err: unknown) => this.status(`Save failed: ${err instanceof Error ? err.message : String(err)}`));
        break;
      }
      case 'export': {
        const json = editor.exportString();
        if (this.options.onExport) this.options.onExport(json);
        else download(json, this.options.fileName ?? 'paths.json');
        this.status(`Exported ${editor.paths.length} path(s).`);
        break;
      }
      case 'copy':
        navigator.clipboard
          ?.writeText(editor.exportString())
          .then(() => this.status('JSON copied to clipboard.'))
          .catch(() => this.status('Clipboard not available.'));
        break;
      case 'import':
        this.$<HTMLInputElement>('file').click();
        break;
    }
  };

  private readonly onChange = (e: Event): void => {
    const target = e.target as HTMLInputElement;
    const editor = this.editor;
    const path = editor.selectedPath;
    const name = target.dataset.el ?? '';
    if (name === 'path') editor.select(target.value || null);
    else if (name === 'pathId' && path) {
      if (!editor.renamePath(path.id, target.value.trim())) {
        this.status('Id is empty or already used.');
        target.value = path.id;
      }
    } else if ((name === 'curve' || name === 'closed' || name === 'tension' || name === 'param') && path) {
      if (!editor.can('editCurve', path)) return;
      if (name === 'curve') path.setCurve({ type: target.value as CurveType });
      else if (name === 'param') path.setCurve({ parametrization: target.value as CatmullRomParametrization });
      else if (name === 'closed') path.setCurve({ closed: target.checked });
      else if (target.value !== '') path.setCurve({ tension: Number(target.value) });
    }
    else if ((name === 'speed-wp' || name === 'roll') && path) {
      const index = editor.selection.waypointIndex;
      if (index === null) return;
      // Empty field = default (speed ×1, roll 0°).
      const value = target.value === '' ? null : Number(target.value);
      if (!editor.can('editWaypointProperties', path, index)) return;
      if (name === 'speed-wp') path.setWaypointProperties(index, { speed: value === null ? null : Math.max(0, value) });
      else path.setWaypointProperties(index, { roll: value });
    } else if ((name === 'x' || name === 'y' || name === 'z') && path) {
      const index = editor.selection.waypointIndex;
      if (index === null || target.value === '') return;
      const pos = [...path.waypoints[index].position];
      pos['xyz'.indexOf(name)] = Number(target.value);
      editor.moveWaypoint(path.id, index, pos);
    } else if ((name === 'meta-wp' || name === 'meta-path') && path) {
      const index = editor.selection.waypointIndex;
      const waypointIndex = name === 'meta-wp' ? index : null;
      if ((name === 'meta-wp' && index === null) || !editor.can('editMetadata', path, waypointIndex)) return;
      const metadata = parseMetadata(target.value);
      target.classList.toggle('tpe-invalid', metadata === null);
      if (metadata === null) {
        this.status('Metadata must be a JSON object, e.g. {"name": "start"}.');
        return;
      }
      if (waypointIndex === null) path.setMetadata(metadata);
      else path.setWaypointMetadata(waypointIndex, metadata);
    } else if (name.startsWith('view-')) editor.setView({ [name.slice(5)]: target.checked });
    else if (name === 'speed' && editor.preview && target.value !== '') editor.preview.speed = Math.max(0, Number(target.value));
    else if (name === 'loop' && editor.preview) editor.preview.loop = target.value as LoopMode;
    else if (name === 'file' && target.files?.[0]) {
      const file = target.files[0];
      file
        .text()
        .then((text) => {
          const paths = editor.import(text);
          this.status(`Imported ${paths.length} path(s) from ${file.name}.`);
        })
        .catch((err: Error) => this.status(`Import failed: ${err.message}`))
        .finally(() => (target.value = ''));
    }
  };

  private template(): string {
    const view = VIEW_LABELS.map(
      ([key, label]) => `<label><input type="checkbox" data-el="view-${key}">${label}</label>`,
    ).join('');
    return `
<header data-act="collapse"><span>${esc(this.options.title ?? 'Path Editor')}</span><span>▾</span></header>
<div class="tpe-body">
  <section>
    <div class="tpe-row">
      <button data-act="enabled" data-el="enabled">Editor</button>
      <button data-act="undo" data-el="undo" title="Undo (Cmd/Ctrl+Z)">↶ Undo</button>
      <button data-act="redo" data-el="redo" title="Redo (Cmd/Ctrl+Shift+Z)">↷ Redo</button>
    </div>
    <h4>Path</h4>
    <div class="tpe-row"><select data-el="path"></select></div>
    <div class="tpe-row"><button data-act="new3d">+ 3D path</button><button data-act="new2d">+ 2D path</button><button data-act="reverse" data-el="reverse">Reverse</button></div>
    <div class="tpe-row"><button class="tpe-danger" data-act="delpath" data-el="delpath">🗑 Delete path</button></div>
    <div class="tpe-row"><label style="flex:1">Id <input type="text" data-el="pathId"></label></div>
    <div class="tpe-row">
      <select data-el="curve"><option value="linear">Linear</option><option value="catmull-rom">Catmull-Rom</option><option value="bezier">Bezier</option></select>
      <label><input type="checkbox" data-el="closed">Closed</label>
      <label title="Tension">T <input type="number" step="0.05" min="0" max="1" data-el="tension"></label>
    </div>
    <div class="tpe-row"><label style="flex:1" title="Catmull-Rom knot spacing; match your runtime curve (e.g. THREE.CatmullRomCurve3 'centripetal')">Spacing <select data-el="param"><option value="uniform">Uniform</option><option value="centripetal">Centripetal</option><option value="chordal">Chordal</option></select></label></div>
  </section>
  <section>
    <h4>Waypoints <span data-el="count"></span></h4>
    <div class="tpe-points" data-el="points"></div>
    <div class="tpe-row">
      <label>X <input type="number" step="0.1" data-el="x"></label>
      <label>Y <input type="number" step="0.1" data-el="y"></label>
      <label>Z <input type="number" step="0.1" data-el="z"></label>
    </div>
    <div class="tpe-row">
      <label title="Speed multiplier at this point (empty = ×1). Blended between points.">Speed × <input type="number" step="0.1" min="0" placeholder="1" data-el="speed-wp"></label>
      <label title="Bank/roll angle in degrees (positive = bank right, empty = 0).">Roll ° <input type="number" step="5" placeholder="0" data-el="roll"></label>
    </div>
    <div class="tpe-row"><label style="flex:1;display:block">Point metadata (JSON)<textarea data-el="meta-wp" spellcheck="false"></textarea></label></div>
    <div class="tpe-row">
      <button data-act="add" data-el="add">+ Add</button><button data-act="del" data-el="del">Delete</button>
      <button data-act="up" data-el="up" title="Move earlier">▲</button><button data-act="down" data-el="down" title="Move later">▼</button>
    </div>
    <div class="tpe-row"><label style="flex:1;display:block">Path metadata (JSON)<textarea data-el="meta-path" spellcheck="false"></textarea></label></div>
  </section>
  <section><h4>View</h4><div class="tpe-row">${view}</div></section>
  <section>
    <h4>Preview</h4>
    <div class="tpe-row"><button data-act="preview" data-el="preview">Preview path</button><button data-act="play" data-el="play">Play</button><button data-act="reset" data-el="reset">Reset</button><button data-act="stop" data-el="stop">Stop</button></div>
    <div class="tpe-row">
      <label>Speed <input type="number" step="0.5" min="0" data-el="speed"></label>
      <select data-el="loop"><option value="none">Once</option><option value="loop">Loop</option><option value="pingpong">Ping-pong</option></select>
    </div>
  </section>
  <section>
    <h4>JSON</h4>
    <div class="tpe-row">${this.options.onSave ? '<button data-act="save" data-el="save">Save</button>' : ''}<button data-act="export">Export</button><button data-act="copy">Copy</button><button data-act="import">Import…</button>
    <input type="file" accept=".json,application/json" data-el="file" style="display:none"></div>
    <div class="tpe-status" data-el="status"></div>
    <div class="tpe-hint">Click: select · Shift+click empty: add point · Shift+click / double-click curve: insert point · Del: delete · [ ]: prev/next · Alt+[ ]: reorder · G: gizmo · Cmd/Ctrl+Z: undo · Shift+Cmd/Ctrl+Z: redo</div>
  </section>
</div>`;
  }
}

function injectStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

/** Updates an input unless the user is typing in it. */
function setValue(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  if (document.activeElement !== input) input.value = value;
}

function stringifyMetadata(metadata: Metadata): string {
  return Object.keys(metadata).length ? JSON.stringify(metadata, null, 1) : '';
}

/** Empty text = `{}`; anything but a JSON object = null. */
function parseMetadata(text: string): Metadata | null {
  if (!text.trim()) return {};
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Metadata) : null;
  } catch {
    return null;
  }
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function uniqueId(editor: PathEditor, base: string): string {
  let i = editor.paths.length + 1;
  while (editor.getPath(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

function download(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
