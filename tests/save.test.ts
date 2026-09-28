// @vitest-environment jsdom
import { PerspectiveCamera, Scene } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PathEditor, PathEditorPanel, saveToDevServer, type SessionStorageLike } from '../src/three';
import type { PathFileData } from '../src/core';
import { DEFAULT_SAVE_ENDPOINT, pathEditorSavePlugin } from '../src/vite';

const disposables: { dispose(): void }[] = [];
afterEach(() => {
  for (const d of disposables.splice(0)) d.dispose();
});

const FILE: PathFileData = {
  version: 1,
  paths: [{ id: 'a', dimension: 3, curve: { type: 'linear' }, points: [{ position: [0, 0, 0] }, { position: [1, 0, 0] }] }],
};

function mountPlugin(options: Partial<Parameters<typeof pathEditorSavePlugin>[0]> = {}) {
  const writes: [string, string][] = [];
  const plugin = pathEditorSavePlugin({
    file: '/project/src/paths/level.paths.json',
    writeFile: async (file, contents) => void writes.push([file, contents]),
    ...options,
  });
  let route = '';
  let handler: ((req: unknown, res: unknown, next: () => void) => void) | null = null;
  plugin.configureServer({ middlewares: { use: (path, fn) => ((route = path), (handler = fn as never)) } });
  const request = (method: string, body = '') =>
    new Promise<{ status: number; body: string }>((resolve) => {
      const listeners: Record<string, ((arg?: unknown) => void)[]> = {};
      const req = { method, on: (event: string, fn: (arg?: unknown) => void) => (listeners[event] ??= []).push(fn) };
      const res = { statusCode: 0, setHeader: () => {}, end: (text = '') => resolve({ status: res.statusCode, body: text }) };
      handler!(req, res, () => {});
      for (const fn of listeners.data ?? []) fn(body);
      for (const fn of listeners.end ?? []) fn();
    });
  return { plugin, writes, request, route: () => route };
}

describe('pathEditorSavePlugin', () => {
  it('only runs on the dev server and mounts on the default endpoint', () => {
    const { plugin, route } = mountPlugin();
    expect(plugin.apply).toBe('serve');
    expect(route()).toBe(DEFAULT_SAVE_ENDPOINT);
  });

  it('validates and writes the posted path file', async () => {
    const { writes, request } = mountPlugin({ indent: 4 });
    const response = await request('POST', JSON.stringify(FILE));
    expect(response.status).toBe(200);
    expect(writes).toEqual([['/project/src/paths/level.paths.json', JSON.stringify(FILE, null, 4) + '\n']]);
  });

  it('rejects anything that is not a valid path file, without writing', async () => {
    const { writes, request } = mountPlugin();
    expect((await request('GET')).status).toBe(405);
    expect((await request('POST', '{nope')).status).toBe(400);
    const invalid = await request('POST', JSON.stringify({ version: 1, paths: [{ id: '', dimension: 3, points: [] }] }));
    expect(invalid.status).toBe(400);
    expect(invalid.body).toContain('id');
    expect((await mountPlugin({ maxBytes: 10 }).request('POST', JSON.stringify(FILE))).status).toBe(413);
    expect(writes).toHaveLength(0);
  });
});

describe('saveToDevServer', () => {
  it('POSTs JSON and surfaces the server message on failure', async () => {
    const fetch = vi.fn(async () => new Response('ok'));
    await saveToDevServer(FILE, { fetch, endpoint: '/save' });
    expect(fetch).toHaveBeenCalledWith('/save', expect.objectContaining({ method: 'POST', body: JSON.stringify(FILE) }));
    const failing = vi.fn(async () => new Response('paths[0].id must be a non-empty string.', { status: 400 }));
    await expect(saveToDevServer('{}', { fetch: failing })).rejects.toThrow('non-empty string');
  });
});

function memoryStorage(): SessionStorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

function makeEditor(camera = new PerspectiveCamera()) {
  const editor = new PathEditor({ scene: new Scene(), camera, domElement: document.createElement('canvas') });
  disposables.push(editor);
  editor.import(FILE);
  return editor;
}

describe('PathEditor sessions', () => {
  it('resumes editing, selection, view and camera after a reload', () => {
    const storage = memoryStorage();
    const before = makeEditor();
    before.enable();
    before.select('a', 1);
    before.setView({ labels: true });
    before.camera.position.set(4, 5, 6);
    expect(before.saveSession('k', storage)).toBe(true);

    const camera = new PerspectiveCamera();
    const after = makeEditor(camera);
    expect(after.restoreSession('k', { storage })).toBe(true);
    expect(after.enabled).toBe(true);
    expect(after.selection).toMatchObject({ pathId: 'a', waypointIndex: 1 });
    expect(after.view.labels).toBe(true);
    expect(camera.position.toArray()).toEqual([4, 5, 6]);
    expect(storage.data.size).toBe(0);
    expect(after.restoreSession('k', { storage })).toBe(false);
  });

  it('skips selections that no longer exist and leaves the camera alone when editing was off', () => {
    const storage = memoryStorage();
    const before = makeEditor();
    before.loadPath({ id: 'gone', dimension: 3, curve: { type: 'linear' }, points: [{ position: [0, 0, 0] }] });
    before.select('gone', 0);
    before.camera.position.set(9, 9, 9);
    before.saveSession('k', storage);

    const camera = new PerspectiveCamera();
    const after = makeEditor(camera);
    after.select(null);
    expect(after.restoreSession('k', { storage })).toBe(true);
    expect(after.enabled).toBe(false);
    expect(after.selection.pathId).toBeNull();
    expect(camera.position.toArray()).toEqual([0, 0, 0]);
  });
});

describe('PathEditorPanel Save', () => {
  it('only shows Save with onSave, and reports the outcome', async () => {
    const editor = makeEditor();
    const plain = new PathEditorPanel(editor);
    expect(plain.element.querySelector('[data-act="save"]')).toBeNull();
    plain.dispose();

    const onSave = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValueOnce(undefined);
    const panel = new PathEditorPanel(editor, { onSave });
    const button = panel.element.querySelector<HTMLButtonElement>('[data-act="save"]')!;
    const status = () => panel.element.querySelector('[data-el="status"]')!.textContent;
    button.click();
    await vi.waitFor(() => expect(status()).toBe('Save failed: disk full'));
    expect(onSave).toHaveBeenCalledWith(editor.exportString());
    button.click();
    await vi.waitFor(() => expect(status()).toBe('Saved 1 path(s).'));
    panel.dispose();
  });
});
