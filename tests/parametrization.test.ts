// @vitest-environment jsdom
import { CatmullRomCurve3, PerspectiveCamera, Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Path, PathFormatError, parsePathFile, type Vec3 } from '../src/core';
import { EditorHistory, EditorState } from '../src/editor';
import { PathEditor, PathEditorPanel } from '../src/three';
import { expectVecClose } from './helpers';

const uneven: Vec3[] = [
  [0, 0, 0],
  [1, 0, 0],
  [30, 4, 2],
  [31, 0, 12],
  [60, 10, 12],
];

describe('Catmull-Rom parametrization', () => {
  for (const [ours, theirs] of [
    ['uniform', 'catmullrom'],
    ['centripetal', 'centripetal'],
    ['chordal', 'chordal'],
  ] as const) {
    for (const closed of [false, true]) {
      it(`${ours} matches THREE.CatmullRomCurve3 '${theirs}' (${closed ? 'closed' : 'open'})`, () => {
        const path = new Path({ points: uneven, curve: { type: 'catmull-rom', closed, parametrization: ours } });
        const three = new CatmullRomCurve3(uneven.map((p) => new Vector3(...p)), closed, theirs, 0.5);
        for (let i = 0; i <= 40; i++) {
          const t = i / 40;
          expectVecClose(path.getPoint(t), three.getPoint(t).toArray(), 6);
        }
      });
    }
  }

  it('still passes through every waypoint at t = i / segmentCount', () => {
    const path = new Path({ points: uneven, curve: { type: 'catmull-rom', parametrization: 'centripetal' } });
    uneven.forEach((p, i) => expectVecClose(path.getPoint(i / path.segmentCount), p));
  });

  it('differs from uniform on uneven spacing', () => {
    const uniform = new Path({ points: uneven });
    const centripetal = new Path({ points: uneven, curve: { type: 'catmull-rom', parametrization: 'centripetal' } });
    const a = uniform.getPoint(0.15);
    const b = centripetal.getPoint(0.15);
    expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeGreaterThan(0.1);
  });

  it('round-trips through JSON, is only written when set, and is validated', () => {
    expect(new Path({ points: uneven }).toJSON().curve).not.toHaveProperty('parametrization');
    const path = new Path({ id: 'p', points: uneven, curve: { type: 'catmull-rom', parametrization: 'chordal' } });
    const [loaded] = parsePathFile({ version: 1, paths: [path.toJSON()] });
    expect(loaded.curve.parametrization).toBe('chordal');
    expect(() =>
      parsePathFile({ version: 1, paths: [{ ...path.toJSON(), curve: { type: 'catmull-rom', parametrization: 'x' } }] }),
    ).toThrow(PathFormatError);
  });

  it('is undoable, including going back to the default', async () => {
    const state = new EditorState();
    const history = new EditorHistory(state);
    const path = new Path({ id: 'p', points: uneven });
    state.addPath(path);
    history.clear();
    path.setCurve({ parametrization: 'centripetal' });
    await Promise.resolve();
    history.undo();
    expect(path.curve).not.toHaveProperty('parametrization');
    history.redo();
    expect(path.curve.parametrization).toBe('centripetal');
  });

  it('can be picked in the panel for Catmull-Rom paths only', () => {
    const editor = new PathEditor({ scene: new Scene(), camera: new PerspectiveCamera(), domElement: document.createElement('canvas') });
    const path = editor.createPath({ id: 'p', points: uneven });
    const panel = new PathEditorPanel(editor);
    const select = panel.element.querySelector<HTMLSelectElement>('[data-el="param"]')!;
    expect(select.disabled).toBe(false);
    select.value = 'centripetal';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(path.curve.parametrization).toBe('centripetal');
    path.setCurve({ type: 'linear' });
    panel.refresh();
    expect(select.disabled).toBe(true);
    panel.dispose();
    editor.dispose();
  });
});
