#!/usr/bin/env node
/**
 * three-path-editor CLI. Non-destructive: never overwrites or deletes files.
 *
 *   path-editor doctor [--json]              inspect the current project
 *   path-editor init [--dir <paths dir>] [--no-skill] [--dry-run]
 *   path-editor meshes <model.glb> [--json]  list the mesh sets a model carries
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PKG_NAME = 'three-path-editor';
const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL_FILES = ['SKILL.md', 'integration.md', 'routes.md', 'troubleshooting.md'];
const VISUALS_SKILL_NAME = `${PKG_NAME}-visuals`;
const VISUALS_SKILL_FILES = ['SKILL.md'];
const SOURCE_EXT = /\.(m?[jt]sx?|vue|svelte)$/;
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'build', 'out', '.git', '.next', '.nuxt', '.vite', 'coverage', '.cache', '.turbo']);
const MAX_FILES = 5000;
const MAX_FILE_BYTES = 1_000_000;

const args = process.argv.slice(2);
const command = args[0];
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const color = process.stdout.isTTY && !flag('json');
const paint = (code, text) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);
const ok = (t) => console.log(`${paint(32, '✓')} ${t}`);
const warn = (t) => console.log(`${paint(33, '!')} ${t}`);
const bad = (t) => console.log(`${paint(31, '✗')} ${t}`);
const info = (t) => console.log(`${paint(36, '·')} ${t}`);
const heading = (t) => console.log(`\n${paint(1, t)}`);

// ----------------------------------------------------------------- helpers

function findProjectRoot(start) {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function walk(root, onFile) {
  let count = 0;
  const visit = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (count >= MAX_FILES) return;
      if (entry.name.startsWith('.') && entry.name !== '.claude') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) visit(full);
      } else if (entry.isFile()) {
        count++;
        onFile(full, entry.name);
      }
    }
  };
  visit(root);
  return count;
}

function readSmall(file) {
  try {
    if (statSync(file).size > MAX_FILE_BYTES) return null;
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function findMatches(text, regex) {
  const lines = [];
  const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
  let m;
  while ((m = re.exec(text))) {
    lines.push(text.slice(0, m.index).split('\n').length);
    if (lines.length >= 5) break;
  }
  return lines;
}

function installedVersion(root, name) {
  // Walk up so hoisted/monorepo installs are found too.
  let dir = root;
  for (;;) {
    const pkg = readJson(join(dir, 'node_modules', name, 'package.json'));
    if (pkg) return pkg.version;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

async function loadCore() {
  try {
    return await import(pathToFileURL(join(PKG_ROOT, 'dist', 'core.js')).href);
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ doctor

const DETECTORS = {
  scene: /new\s+(?:THREE\.)?Scene\s*\(/,
  camera: /new\s+(?:THREE\.)?(?:Perspective|Orthographic)Camera\s*\(/,
  renderer: /new\s+(?:THREE\.)?(?:WebGLRenderer|WebGPURenderer)\s*\(/,
  loop: /\.setAnimationLoop\s*\(|requestAnimationFrame\s*\(|useFrame\s*\(/,
  cameraControls: /new\s+(?:\w+\.)?(?:OrbitControls|MapControls|TrackballControls|FlyControls|FirstPersonControls|PointerLockControls|CameraControls)\s*\(/,
  threeImport: /from\s+['"]three['"]|require\(\s*['"]three['"]\s*\)/,
  r3f: /from\s+['"]@react-three\/fiber['"]/,
  pkgImport: /from\s+['"]three-path-editor(?:\/core)?['"]/,
  editorImport: /['"]three-path-editor\/editor['"]/,
  staticEditorImport: /^\s*import\s[^;]*?from\s+['"]three-path-editor\/editor['"]/m,
  devGuard: /import\.meta\.env\.(?:DEV|PROD|MODE)|process\.env\.NODE_ENV|__DEV__/,
  pathEditor: /new\s+PathEditor\s*\(/,
  pathFollower: /new\s+PathFollower\s*\(/,
  editorUpdate: /editor\w*\.update\s*\(|pathEditor\w*\.update\s*\(/i,
  // Fallback hints for scenes/cameras created by loaders or engine wrappers.
  sceneHint: /ObjectLoader|\bscene\.add\s*\(|addToScene\s*\(|\.scene\s*=|getScene\s*\(/,
  cameraHint: /\bcamera\s*[:=]|getCamera\s*\(|\.camera\b/,
};

async function doctor() {
  const root = findProjectRoot(process.cwd());
  const pkg = readJson(join(root, 'package.json')) ?? {};
  const deps = { ...pkg.peerDependencies, ...pkg.devDependencies, ...pkg.dependencies };
  const report = {
    root,
    name: pkg.name ?? null,
    three: { declared: deps.three ?? null, installed: installedVersion(root, 'three') },
    typesThree: deps['@types/three'] ?? null,
    pathEditor: { declared: deps[PKG_NAME] ?? null, installed: installedVersion(root, PKG_NAME) },
    bundler: ['vite', 'webpack', 'parcel', 'next', 'esbuild', 'rollup'].find((b) => deps[b]) ?? null,
    typescript: Boolean(deps.typescript) || existsSync(join(root, 'tsconfig.json')),
    sourceDirs: ['src', 'app', 'lib', 'client', 'game', 'public'].filter((d) => existsSync(join(root, d))),
    detections: Object.fromEntries(Object.keys(DETECTORS).map((k) => [k, []])),
    unguardedEditorImports: [],
    pathFiles: [],
    skillInstalled: existsSync(join(root, '.claude', 'skills', PKG_NAME, 'SKILL.md')),
    scannedFiles: 0,
  };
  const core = await loadCore();

  report.scannedFiles = walk(root, (file, name) => {
    const rel = relative(root, file);
    if (SOURCE_EXT.test(name) && !name.endsWith('.d.ts')) {
      const text = readSmall(file);
      if (!text) return;
      for (const [key, regex] of Object.entries(DETECTORS)) {
        const lines = findMatches(text, regex);
        if (lines.length) report.detections[key].push({ file: rel, lines });
      }
      if (DETECTORS.staticEditorImport.test(text) && !DETECTORS.devGuard.test(text)) report.unguardedEditorImports.push(rel);
    } else if (name.endsWith('.json') && name !== 'package.json' && name !== 'package-lock.json' && !name.startsWith('tsconfig')) {
      const text = readSmall(file);
      if (!text || !text.includes('"paths"') || !text.includes('"points"')) return;
      const entry = { file: rel, paths: [], error: null };
      try {
        if (core) entry.paths = core.parsePathFile(text).map((p) => `${p.id} (${p.dimension}D, ${p.waypoints.length} pts)`);
        else entry.paths = (JSON.parse(text).paths ?? []).map((p) => `${p.id}`);
      } catch (err) {
        entry.error = err.message;
      }
      report.pathFiles.push(entry);
    }
  });

  if (flag('json')) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  printDoctor(report);
}

function printDoctor(r) {
  const d = r.detections;
  const where = (list) => list.slice(0, 4).map((m) => `${m.file}:${m.lines[0]}`).join(', ') + (list.length > 4 ? `, +${list.length - 4} more` : '');

  console.log(paint(1, `three-path-editor doctor`) + `  ${r.root}`);

  heading('Project');
  info(`package: ${r.name ?? '(unnamed)'}${r.bundler ? ` · bundler: ${r.bundler}` : ''}${r.typescript ? ' · TypeScript' : ''}`);
  info(`source dirs: ${r.sourceDirs.join(', ') || '(none found)'} · ${r.scannedFiles} files scanned`);
  if (r.three.installed || r.three.declared) ok(`Three.js detected: declared ${r.three.declared ?? '-'}, installed ${r.three.installed ?? 'not installed'}`);
  else bad('Three.js not found in package.json — this package needs an existing Three.js project.');
  if (r.three.installed && /^0\.(\d+)/.test(r.three.installed) && Number(RegExp.$1) < 150) warn('Three.js < r150 is not tested; upgrade recommended.');
  if (r.typescript && !r.typesThree) warn('TypeScript project without @types/three: editor/follower types will be `any`.');

  heading('Existing Three.js setup (reuse these — do not create new ones)');
  const report = (label, list, missing, multiple) => {
    if (!list.length) warn(`${label}: not detected. ${missing}`);
    else {
      ok(`${label}: ${where(list)}`);
      if (multiple && list.length > 1) warn(`${label}: found in ${list.length} files — make sure you pick the one actually rendered.`);
    }
  };
  if (d.r3f.length) warn(`react-three-fiber detected (${where(d.r3f)}): get scene/camera/gl from useThree() and call update() in useFrame().`);
  report('Scene', d.scene, 'It may be created by a loader or engine wrapper.', true);
  if (!d.scene.length && d.sceneHint.length) info(`  possible scene references: ${where(d.sceneHint)}`);
  report('Camera', d.camera, 'Look for a camera factory, loader or framework.', true);
  if (!d.camera.length && d.cameraHint.length) info(`  possible camera references: ${where(d.cameraHint)}`);
  report('Renderer', d.renderer, 'Look for a renderer wrapper (engine, R3F, etc.).', true);
  report('Update loop', d.loop, 'Find where the game renders each frame; editor.update(dt) goes there.', false);
  if (d.cameraControls.length) info(`Camera controls: ${where(d.cameraControls)} → pass as \`cameraControls\` to PathEditor.`);

  heading('three-path-editor');
  if (r.pathEditor.declared || r.pathEditor.installed) ok(`installed: declared ${r.pathEditor.declared ?? '-'}, installed ${r.pathEditor.installed ?? 'run npm install'}`);
  else warn(`not installed. Run: npm install ${PKG_NAME}  (or github:<owner>/three-js-path-editor)`);
  if (d.pkgImport.length) ok(`runtime import: ${where(d.pkgImport)}`);
  if (d.pathFollower.length) ok(`PathFollower used: ${where(d.pathFollower)}`);
  if (d.editorImport.length) ok(`editor import: ${where(d.editorImport)}`);
  if (d.pathEditor.length) {
    ok(`PathEditor created: ${where(d.pathEditor)}`);
    if (!d.editorUpdate.length) warn('No editor.update(dt) call found — paths will not render or respond. Call it from the update loop.');
  }
  for (const file of r.unguardedEditorImports) {
    warn(`${file}: static import of three-path-editor/editor without a dev guard — the editor will ship in production. Use a dynamic import behind import.meta.env.DEV.`);
  }

  heading('Path files');
  if (!r.pathFiles.length) warn('No path JSON files found. `npx path-editor init` creates an example.');
  for (const f of r.pathFiles) {
    if (f.error) bad(`${f.file}: ${f.error}`);
    else ok(`${f.file}: ${f.paths.join(', ') || '(no paths)'}`);
  }

  heading('AI integration');
  if (r.skillInstalled) ok(`Claude Code skill installed at .claude/skills/${PKG_NAME}/`);
  else info(`Claude Code skill not installed in this project (npx path-editor init adds it to .claude/skills/${PKG_NAME}/).`);

  heading('Integration status');
  const installed = Boolean(r.pathEditor.declared || r.pathEditor.installed);
  const status = !r.three.declared && !r.three.installed
    ? 'no Three.js project detected'
    : !installed
      ? 'not installed'
      : d.pathEditor.length && d.pathFollower.length
        ? 'editor + runtime integrated'
        : d.pathEditor.length
          ? 'editor integrated (no PathFollower yet)'
          : d.pathFollower.length || d.pkgImport.length
            ? 'runtime integrated (no editor)'
            : 'installed, not used yet';
  console.log(`  ${paint(1, status)}\n`);
}

// -------------------------------------------------------------------- init

const EXAMPLE_FILE = {
  version: 1,
  paths: [
    {
      id: 'example-route',
      name: 'Example route',
      dimension: 3,
      curve: { type: 'catmull-rom', closed: false, tension: 0.5 },
      points: [{ position: [0, 5, 0] }, { position: [10, 8, -10] }, { position: [20, 6, -25] }],
      metadata: {},
    },
  ],
};

function init() {
  const root = findProjectRoot(process.cwd());
  const dryRun = flag('dry-run');
  const pkg = readJson(join(root, 'package.json')) ?? {};
  const deps = { ...pkg.devDependencies, ...pkg.dependencies };
  const actions = [];
  const act = (description, fn) => {
    actions.push(description);
    if (!dryRun) fn();
  };

  console.log(paint(1, `three-path-editor init`) + `  ${root}${dryRun ? paint(33, '  (dry run)') : ''}\n`);
  if (!deps.three) warn('three is not a dependency of this project. Install it first (npm install three).');
  if (!deps[PKG_NAME]) warn(`${PKG_NAME} is not in package.json yet. Install: npm install ${PKG_NAME}`);

  const dir = option('dir') ?? (existsSync(join(root, 'src')) ? 'src/paths' : 'paths');
  const pathsDir = resolve(root, dir);
  const hasJson = existsSync(pathsDir) && readdirSync(pathsDir).some((f) => f.endsWith('.json'));
  if (!existsSync(pathsDir)) act(`create ${dir}/`, () => mkdirSync(pathsDir, { recursive: true }));
  if (hasJson) info(`${dir}/ already contains JSON files — leaving them untouched.`);
  else {
    const file = join(pathsDir, 'example.paths.json');
    act(`create ${relative(root, file)}`, () => writeFileSync(file, JSON.stringify(EXAMPLE_FILE, null, 2) + '\n', { flag: 'wx' }));
  }

  if (!flag('no-skill')) {
    installSkill(root, PKG_NAME, SKILL_FILES, 'skills', act);
    installSkill(root, VISUALS_SKILL_NAME, VISUALS_SKILL_FILES, join('skills', 'visuals'), act);
  }

  for (const a of actions) (dryRun ? info : ok)(a);
  if (!actions.length) info('Nothing to do.');

  console.log(`
Next steps
  1. Run ${paint(1, 'npx path-editor doctor')} to locate your scene, camera, renderer and loop.
  2. In development only, create the editor with your existing objects:

     if (import.meta.env.DEV) {
       const { PathEditor, PathEditorPanel } = await import('three-path-editor/editor');
       const editor = new PathEditor({ scene, camera, renderer, cameraControls: controls });
       editor.enable();
       new PathEditorPanel(editor);
       // in your existing loop: editor.update(dt);
     }

  3. At runtime, load routes with parsePathFile() and move objects with PathFollower.
  See README.md and skills/SKILL.md for details.
`);
}

function installSkill(root, name, files, sourceDir, act) {
  const skillDir = join(root, '.claude', 'skills', name);
  for (const file of files) {
    const target = join(skillDir, file);
    const source = join(PKG_ROOT, sourceDir, file);
    if (existsSync(target)) info(`${relative(root, target)} exists — skipped.`);
    else if (existsSync(source)) {
      act(`add ${relative(root, target)}`, () => {
        mkdirSync(skillDir, { recursive: true });
        copyFileSync(source, target);
      });
    }
  }
}

// ------------------------------------------------------------------ meshes

/**
 * The mesh sets a glTF/GLB carries, by name: what the editor's Visuals tab
 * offers and what a visuals file's `worn` entries are written against. Reads
 * the JSON chunk itself, so the CLI stays dependency-free; Draco or any other
 * compression only touches the geometry, never the node names.
 */
function readGltfMeshNames(file) {
  const buffer = readFileSync(file);
  let json;
  if (buffer.length > 12 && buffer.readUInt32LE(0) === 0x46546c67) {
    for (let offset = 12; offset + 8 <= buffer.length; ) {
      const length = buffer.readUInt32LE(offset);
      const type = buffer.readUInt32LE(offset + 4);
      if (type === 0x4e4f534a) {
        json = JSON.parse(buffer.subarray(offset + 8, offset + 8 + length).toString('utf8'));
        break;
      }
      offset += 8 + length;
    }
    if (!json) throw new Error('No JSON chunk in this GLB.');
  } else {
    json = JSON.parse(buffer.toString('utf8'));
  }

  const names = [];
  for (const node of json.nodes ?? []) {
    if (node.mesh === undefined || !node.name) continue;
    // GLTFLoader strips dots from node names; match what the scene will hold.
    const name = String(node.name).replace(/\./g, '');
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

function meshes() {
  const file = args[1];
  if (!file) {
    bad('Usage: path-editor meshes <model.glb>');
    process.exitCode = 1;
    return;
  }
  if (!existsSync(file)) {
    bad(`${file} does not exist.`);
    process.exitCode = 1;
    return;
  }

  let names;
  try {
    names = readGltfMeshNames(file);
  } catch (err) {
    bad(`Could not read ${file}: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  if (flag('json')) {
    console.log(JSON.stringify({ file, sets: names }, null, 2));
    return;
  }
  heading(`Mesh sets in ${file} (${names.length})`);
  for (const name of names) info(name);
  if (names.length === 0) warn('No named meshes: the Visuals tab will have nothing to dress.');
}

// -------------------------------------------------------------------- main

function help() {
  console.log(`three-path-editor CLI

Usage:
  path-editor doctor [--json]      Inspect the project: Three.js, scene/camera/renderer/loop, path files, integration status
  path-editor init [options]       Create a paths directory with an example file and install the Claude Code skills
  path-editor meshes <model.glb>   List the mesh sets a model carries, for the editor's Visuals tab (--json)

Init options:
  --dir <dir>     Paths directory (default: src/paths, or paths/ without src/)
  --no-skill      Do not copy the Claude Code skill into .claude/skills/
  --dry-run       Show what would be created

The CLI never overwrites or deletes files.`);
}

switch (command) {
  case 'doctor':
    await doctor();
    break;
  case 'init':
    init();
    break;
  case 'meshes':
    meshes();
    break;
  default:
    help();
    if (command && command !== 'help' && command !== '--help' && command !== '-h') process.exitCode = 1;
}
