#!/usr/bin/env node
/**
 * Pack this package into a creative's `vendor/` folder and point its
 * package.json at the tarball, for platforms that run `npm install` on an
 * uploaded zip and cannot reach a registry.
 *
 *   node scripts/release-vendor.mjs <creative-dir> [options]
 *
 *   --bump <patch|minor|major|x.y.z>  bump this package's version first
 *   --no-tag                          bump without a git commit and tag
 *   --skip-tests                      don't run `npm test` and `npm run typecheck`
 *   --prune                           delete older tarballs of this package from vendor/
 *   --vendor <dir>                    vendor folder inside the creative (default: vendor)
 *   --install                         run `npm install` in the creative afterwards
 *   --dry-run                         report what would happen, change nothing
 *
 * `npm pack` runs `prepare`, so the tarball always carries a fresh `dist`.
 * Nothing in the creative is deleted unless --prune is given.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const USAGE = `
  node scripts/release-vendor.mjs <creative-dir> [options]

  --bump <patch|minor|major|x.y.z>  bump this package's version first
  --no-tag                          bump without a git commit and tag
  --skip-tests                      don't run \`npm test\` and \`npm run typecheck\`
  --prune                           delete older tarballs of this package from vendor/
  --vendor <dir>                    vendor folder inside the creative (default: vendor)
  --install                         run \`npm install\` in the creative afterwards
  --dry-run                         report what would happen, change nothing
`;

const TAKES_VALUE = new Set(['bump', 'vendor']);
const argv = process.argv.slice(2);
const positional = [];
const options = new Map();
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (!arg.startsWith('--')) {
    positional.push(arg);
    continue;
  }
  const name = arg.slice(2);
  options.set(name, TAKES_VALUE.has(name) ? argv[++i] : true);
}
const flag = (name) => options.get(name) === true;
const option = (name, fallback) => (typeof options.get(name) === 'string' ? options.get(name) : fallback);

const color = process.stdout.isTTY;
const paint = (code, text) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);
const ok = (t) => console.log(`${paint(32, '✓')} ${t}`);
const warn = (t) => console.log(`${paint(33, '!')} ${t}`);
const info = (t) => console.log(`${paint(36, '·')} ${t}`);
const heading = (t) => console.log(`\n${paint(1, t)}`);
const die = (t) => {
  console.error(`${paint(31, '✗')} ${t}`);
  process.exit(1);
};

const dryRun = flag('dry-run');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(args, { cwd = PKG_ROOT, capture = false } = {}) {
  info(`${npm} ${args.join(' ')}${cwd === PKG_ROOT ? '' : ` (in ${cwd})`}`);
  if (dryRun) return '';
  const r = spawnSync(npm, args, {
    cwd,
    stdio: capture ? ['inherit', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8',
  });
  if (r.status !== 0) die(`\`npm ${args.join(' ')}\` failed`);
  return capture ? r.stdout : '';
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function gitClean() {
  const r = spawnSync('git', ['status', '--porcelain'], { cwd: PKG_ROOT, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() === '' : true;
}

function help() {
  console.log(USAGE);
}

// ------------------------------------------------------------------- target

if (flag('help') || flag('h')) {
  help();
  process.exit(0);
}

const target = positional[0];
if (!target) {
  help();
  die('no creative directory given');
}

const creative = resolve(target);
const creativePkgFile = join(creative, 'package.json');
const creativePkg = readJson(creativePkgFile);
if (!creativePkg) die(`${creativePkgFile} not found or not valid JSON — is that the creative's root?`);

const pkg = readJson(join(PKG_ROOT, 'package.json'));
const vendorRel = option('vendor', 'vendor').replace(/\\/g, '/').replace(/\/+$/, '');
const vendorDir = join(creative, vendorRel);

heading(`${pkg.name} → ${creative}`);

// ------------------------------------------------------------- checks, bump

const bump = option('bump');
if (bump && !gitClean()) {
  die('the working tree is dirty; commit first, or bump the version by hand and run without --bump');
} else if (!gitClean()) {
  warn('the working tree is dirty — the tarball is built from the files on disk, not from HEAD');
}

if (!flag('skip-tests')) {
  run(['test']);
  run(['run', 'typecheck']);
} else {
  warn('tests skipped');
}

if (bump) {
  run(['version', bump, ...(flag('no-tag') ? ['--no-git-tag-version'] : [])]);
}

const version = dryRun && bump ? `<${bump}>` : readJson(join(PKG_ROOT, 'package.json')).version;
const tarball = `${pkg.name}-${version}.tgz`;
const spec = `file:${vendorRel}/${tarball}`;

// --------------------------------------------------------------------- pack

if (!existsSync(vendorDir)) {
  info(`creating ${vendorDir}`);
  if (!dryRun) mkdirSync(vendorDir, { recursive: true });
}

const stale = existsSync(vendorDir)
  ? readdirSync(vendorDir).filter((f) => f.startsWith(`${pkg.name}-`) && f.endsWith('.tgz') && f !== tarball)
  : [];

// `npm pack` runs `prepare`, which builds dist.
const packed = run(['pack', '--pack-destination', vendorDir], { capture: true });
const packedName = packed.trim().split('\n').filter(Boolean).pop();
if (packedName && packedName !== tarball) {
  warn(`npm packed ${packedName}, expected ${tarball} — using what npm produced`);
}
ok(`packed ${join(vendorRel, packedName || tarball)}`);

if (stale.length) {
  if (flag('prune')) {
    for (const f of stale) {
      info(`removing ${join(vendorRel, f)}`);
      if (!dryRun) rmSync(join(vendorDir, f));
    }
  } else {
    warn(`older tarballs still in ${vendorRel}/: ${stale.join(', ')} — they ship in the zip too; pass --prune to delete them`);
  }
}

// ---------------------------------------------------- the creative's manifest

const raw = readFileSync(creativePkgFile, 'utf8');
const field = ['dependencies', 'devDependencies'].find((f) => creativePkg[f]?.[pkg.name]);
let next = raw;

if (field) {
  const was = creativePkg[field][pkg.name];
  if (was === spec) {
    ok(`${field}.${pkg.name} already "${spec}"`);
  } else {
    const line = new RegExp(`("${pkg.name}"\\s*:\\s*)"[^"]*"`);
    next = raw.replace(line, `$1${JSON.stringify(spec)}`);
    if (next === raw) die(`could not rewrite "${pkg.name}" in ${creativePkgFile} — edit it by hand: "${spec}"`);
    ok(`${field}.${pkg.name}: "${was}" → "${spec}"`);
  }
} else {
  const merged = { ...creativePkg, dependencies: { ...creativePkg.dependencies, [pkg.name]: spec } };
  next = `${JSON.stringify(merged, null, 2)}\n`;
  warn(`${pkg.name} was not a dependency — added to dependencies (the file is reformatted with 2-space indent)`);
}

if (next !== raw && !dryRun) writeFileSync(creativePkgFile, next);

// ------------------------------------------------------------------- hygiene

const ignoreFile = join(creative, '.gitignore');
if (existsSync(ignoreFile)) {
  const ignored = readFileSync(ignoreFile, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .some((l) => l === '*.tgz' || l === vendorRel || l === `${vendorRel}/` || l === `/${vendorRel}` || l === `/${vendorRel}/`);
  if (ignored) warn(`${vendorRel}/ or *.tgz is in the creative's .gitignore — the tarball must be committed and must reach the zip`);
}

// ---------------------------------------------------------------------- done

if (flag('install')) {
  run(['install'], { cwd: creative });
  ok('installed');
} else {
  heading('Next, in the creative');
  console.log(`  cd ${creative}`);
  console.log('  npm i          # updates package-lock.json — commit it with the tarball');
  console.log('  npm run build');
}
