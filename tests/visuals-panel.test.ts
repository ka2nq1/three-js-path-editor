// @vitest-environment jsdom
import { Group, Mesh, PerspectiveCamera, Scene } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PathEditor, PathEditorPanel, VisualsEditor, VisualsPanel } from '../src/three';

const disposables: { dispose(): void }[] = [];
afterEach(() => {
  for (const d of disposables.splice(0)) d.dispose();
  document.body.innerHTML = '';
});

function rig(...names: string[]) {
  const root = new Group();
  for (const name of names) {
    const mesh = new Mesh();
    mesh.name = name;
    root.add(mesh);
  }
  return root;
}

function visualsPanel(options: Partial<ConstructorParameters<typeof VisualsEditor>[0]> = {}, panelOptions = {}) {
  const editor = new VisualsEditor({ subjects: [{ id: 'Guard', object: rig('Body', 'Helmet') }], ...options });
  const panel = new VisualsPanel(editor, panelOptions);
  disposables.push(panel, editor);
  return { editor, panel };
}

describe('VisualsPanel', () => {
  it('says which skill to apply and where the meshes live when there is no file', () => {
    const { panel } = visualsPanel({ file: 'src/visuals/characters.visuals.json', source: 'Characters.glb' });
    const note = panel.element.querySelector('.tpe-note')!;

    expect(note).not.toBeNull();
    expect(note.textContent).toContain('three-path-editor-visuals');
    expect(note.textContent).toContain('Characters.glb');
    expect(note.textContent).toContain('src/visuals/characters.visuals.json');
    expect([...note.querySelectorAll('code')].map((c) => c.textContent)).toContain('Characters.glb');
    // The sets are still listed: a missing file never costs you the tab.
    expect(panel.element.querySelectorAll('label[data-set]')).toHaveLength(2);
  });

  it('keeps the note out of the way once the file is there', () => {
    const { panel } = visualsPanel({ data: { version: 1, subjects: [{ id: 'Guard', worn: ['Body'] }] } });
    expect(panel.element.querySelector('.tpe-note')).toBeNull();
  });

  it('still names the skill when the model handed over nothing to dress', () => {
    const { panel } = visualsPanel({ subjects: [{ id: 'Guard', object: new Group() }], source: 'Characters.glb' });
    const note = panel.element.querySelector('.tpe-note')!;

    expect(note.textContent).toContain('three-path-editor-visuals');
    expect(note.textContent).toContain('carries no named meshes');
    expect(panel.element.querySelectorAll('label[data-set]')).toHaveLength(0);
  });

  it('dresses the object from a checkbox and saves the file', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { editor, panel } = visualsPanel(
      { data: { version: 1, subjects: [{ id: 'Guard', worn: ['Body'] }] } },
      { onSave },
    );
    const helmet = panel.element.querySelector<HTMLInputElement>('label[data-set="Helmet"] input')!;

    helmet.checked = true;
    helmet.dispatchEvent(new Event('change'));
    expect(editor.isWorn('Guard', 'Helmet')).toBe(true);

    panel.element.querySelectorAll('button').forEach((b) => b.textContent === 'Save' && b.click());
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(JSON.parse(onSave.mock.calls[0][0] as string).subjects).toEqual([
      { id: 'Guard', worn: ['Body', 'Helmet'] },
    ]);
  });
});

describe('PathEditorPanel tabs', () => {
  function pathPanel(options: ConstructorParameters<typeof PathEditorPanel>[1] = {}) {
    const scene = new Scene();
    const editor = new PathEditor({ scene, camera: new PerspectiveCamera(), domElement: document.createElement('canvas') });
    const panel = new PathEditorPanel(editor, options);
    disposables.push(panel, editor);
    return { scene, editor, panel };
  }

  it('carries a Visuals tab out of the box, telling the project how to set it up', () => {
    const { panel } = pathPanel();
    const strip = panel.element.querySelector<HTMLElement>('[data-el="tabs"]')!;

    expect([...strip.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Paths', 'Visuals']);
    expect(panel.visuals).not.toBeNull();
    expect(panel.element.querySelector('.tpe-note')!.textContent).toContain('three-path-editor-visuals');
  });

  it('finds what the scene already carries, with nothing configured', () => {
    const { scene, panel } = pathPanel();
    const unit = rig('Body', 'Helmet');
    unit.name = 'Guard';
    const prop = rig('Crate');
    prop.name = 'Crate';
    scene.add(unit, prop);
    panel.visuals!.refresh();

    // One mesh is a prop, not a wardrobe.
    expect(panel.visuals!.subjects.map((s) => s.id)).toEqual(['Guard']);
    expect(panel.visuals!.setsOf('Guard')).toEqual(['Body', 'Helmet']);
  });

  it('leaves the tab out when asked', () => {
    const { panel } = pathPanel({ visuals: false });
    expect(panel.visuals).toBeNull();
    expect(panel.element.querySelector<HTMLElement>('[data-el="tabs"]')!.style.display).toBe('none');
  });

  it('shows one tab at a time and leaves a host element alone', () => {
    const { panel } = pathPanel({ visuals: false });
    const { panel: host } = visualsPanel();
    panel.addTab(host.tab);

    const strip = panel.element.querySelector<HTMLElement>('[data-el="tabs"]')!;
    const body = panel.element.querySelector<HTMLElement>('[data-el="body"]')!;
    expect(strip.style.display).toBe('');
    expect(panel.activeTab).toBe(0);
    expect(host.element.style.display).toBe('none');

    strip.querySelectorAll('button')[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(panel.activeTab).toBe(1);
    expect(body.style.display).toBe('none');
    expect(host.element.style.display).toBe('');
  });
});
