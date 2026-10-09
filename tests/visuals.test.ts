import { Group, Mesh, Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import {
  readVisualsFile,
  serializeVisuals,
  stringifyVisuals,
  VisualsFormatError,
  VISUALS_FORMAT_VERSION,
  wornOf,
} from '../src/core/visuals';
import { applyVisuals, meshSetsOf } from '../src/runtime/VisualSets';
import { VisualsEditor } from '../src/three/VisualsEditor';

function rig(...names: string[]): Object3D {
  const root = new Group();
  root.name = 'Rig';
  for (const name of names) {
    const mesh = new Mesh();
    mesh.name = name;
    root.add(mesh);
  }
  return root;
}

function meshNamed(object: Object3D, name: string): Mesh {
  return object.getObjectByName(name) as Mesh;
}

describe('visuals file format', () => {
  it('round-trips subjects, the source and unknown keys', () => {
    const json = stringifyVisuals([{ id: 'Guard', worn: ['Boss', 'Cigar'], note: 'boss' }], 2, {
      source: 'Characters.glb',
      extras: { story: 'ours' },
    });
    const file = readVisualsFile(json);

    expect(file.version).toBe(VISUALS_FORMAT_VERSION);
    expect(file.source).toBe('Characters.glb');
    expect(file.extras).toEqual({ story: 'ours' });
    expect(wornOf(file, 'Guard')).toEqual(['Boss', 'Cigar']);
    expect(file.subjects[0].note).toBe('boss');
    expect(readVisualsFile(serializeVisuals(file.subjects, { source: file.source })).subjects).toEqual(file.subjects);
  });

  it('rejects what it cannot read', () => {
    expect(() => readVisualsFile('nope')).toThrow(VisualsFormatError);
    expect(() => readVisualsFile({ subjects: {} })).toThrow(VisualsFormatError);
    expect(() => readVisualsFile({ subjects: [{ id: 'a' }] })).toThrow(VisualsFormatError);
    expect(() => readVisualsFile({ subjects: [{ id: 'a', worn: [] }, { id: 'a', worn: [] }] })).toThrow(/Duplicate/);
    expect(() => readVisualsFile({ version: 99, subjects: [] })).toThrow(/newer/);
  });
});

describe('mesh sets', () => {
  it('lists named meshes and draws only what is worn', () => {
    const object = rig('Body', 'Helmet', 'Bandana');
    expect(meshSetsOf(object)).toEqual(['Body', 'Helmet', 'Bandana']);

    const result = applyVisuals(object, ['Body', 'Helmet', 'Cape']);
    expect(result.applied.sort()).toEqual(['Body', 'Helmet']);
    expect(result.missing).toEqual(['Cape']);
    expect(meshNamed(object, 'Bandana').visible).toBe(false);
    expect(meshNamed(object, 'Helmet').visible).toBe(true);
  });

  it('leaves unnamed meshes and editor-owned objects alone', () => {
    const object = rig('Body');
    const unnamed = new Mesh();
    const editorOwned = new Mesh();
    editorOwned.name = 'Gizmo';
    editorOwned.userData.pathEditor = true;
    object.add(unnamed, editorOwned);

    applyVisuals(object, []);
    expect(meshSetsOf(object)).toEqual(['Body']);
    expect(unnamed.visible).toBe(true);
    expect(editorOwned.visible).toBe(true);
  });
});

describe('VisualsEditor', () => {
  const subjects = () => [{ id: 'Guard', object: rig('Body', 'Helmet', 'Bandana') }];

  it('dresses from the file and hides the rest', () => {
    const cast = subjects();
    const editor = new VisualsEditor({
      subjects: cast,
      data: { version: 1, subjects: [{ id: 'Guard', worn: ['Body', 'Helmet'] }] },
    });

    expect(editor.problems).toEqual([]);
    expect(editor.setupHint).toBeNull();
    expect(editor.isWorn('Guard', 'Helmet')).toBe(true);
    expect(meshNamed(cast[0].object, 'Bandana').visible).toBe(false);

    editor.setWorn('Guard', 'Helmet', false);
    expect(meshNamed(cast[0].object, 'Helmet').visible).toBe(false);
    expect(JSON.parse(editor.exportString()).subjects).toEqual([{ id: 'Guard', worn: ['Body'] }]);
  });

  it('names the skill and the model file when there is no visuals file', () => {
    const editor = new VisualsEditor({
      subjects: subjects(),
      file: 'src/visuals/characters.visuals.json',
      source: 'Characters.glb',
    });

    expect(editor.problems.map((p) => p.code)).toEqual(['no-file']);
    expect(editor.setupHint).toContain('three-path-editor-visuals');
    expect(editor.setupHint).toContain('Characters.glb');
    expect(editor.setupHint).toContain('src/visuals/characters.visuals.json');
  });

  it('keeps what the model draws when the file says nothing about a subject', () => {
    const cast = subjects();
    meshNamed(cast[0].object, 'Bandana').visible = false;
    const editor = new VisualsEditor({ subjects: cast, data: { version: 1, subjects: [] } });

    expect(editor.isWorn('Guard', 'Body')).toBe(true);
    expect(editor.isWorn('Guard', 'Bandana')).toBe(false);
  });

  it('reports a stale file instead of throwing', () => {
    const editor = new VisualsEditor({
      subjects: subjects(),
      data: {
        version: 1,
        subjects: [
          { id: 'Guard', worn: ['Body', 'Jetpack'] },
          { id: 'Ghost', worn: ['Body'] },
        ],
      },
    });

    expect(editor.problems.map((p) => p.code).sort()).toEqual(['unknown-set', 'unknown-subject']);
    expect(editor.isWorn('Guard', 'Body')).toBe(true);
    expect(editor.setupHint).toBeNull();
  });

  it('survives unreadable data, a throwing subject source and an empty model', () => {
    const broken = new VisualsEditor({ subjects: () => [{ id: 'Guard', object: new Group() }], data: '{ nope' });
    expect(broken.problems.map((p) => p.code).sort()).toEqual(['file-invalid', 'no-sets']);
    expect(broken.isUsable).toBe(false);
    expect(broken.setupHint).toContain('three-path-editor-visuals');

    const thrower = new VisualsEditor({
      subjects: () => {
        throw new Error('cast is not built yet');
      },
    });
    expect(thrower.problems.map((p) => p.code)).toContain('no-subjects');
    expect(thrower.exportString()).toContain('"subjects"');
  });

  it('takes the other set off an exclusive group, and restores on dispose', () => {
    const cast = subjects();
    const editor = new VisualsEditor({
      subjects: cast,
      data: { version: 1, subjects: [{ id: 'Guard', worn: ['Body', 'Helmet'] }] },
      exclusive: [['Helmet', 'Bandana']],
    });

    editor.setWorn('Guard', 'Bandana', true);
    expect(editor.isWorn('Guard', 'Helmet')).toBe(false);
    expect(meshNamed(cast[0].object, 'Helmet').visible).toBe(false);

    editor.dispose();
    expect(meshNamed(cast[0].object, 'Helmet').visible).toBe(true);
    expect(meshNamed(cast[0].object, 'Bandana').visible).toBe(true);
  });
});
