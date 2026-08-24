#!/usr/bin/env node
/**
 * deps-report.mjs — one machine-readable picture of every dependency in this
 * repo: the six independent packages, what each declares, what actually gets
 * installed, how much it weighs, and where the graph contradicts itself.
 *
 * Why this exists: DevDigest is NOT a workspace. Six package.json files with
 * six lockfiles and two package managers mean no single `pnpm ls` ever shows
 * the whole picture, and "which version of zod do we actually ship" is a
 * question no one can answer by reading one file. Every number here is
 * measured, never estimated — the agent that runs this script (see
 * .claude/skills/dependencies-checker/SKILL.md) supplies the judgement, this
 * script supplies the facts.
 *
 * Offline by default: it reads manifests, lockfile-driven `ls` output and the
 * bytes already on disk. `--outdated` and `--audit` are the only lanes that
 * touch the network, and they are opt-in.
 *
 * Usage:
 *   node scripts/deps-report.mjs                      # markdown report to stdout
 *   node scripts/deps-report.mjs --json               # full model as JSON (agent mode)
 *   node scripts/deps-report.mjs --out docs/dependencies/2026-08-24-deps.md
 *   node scripts/deps-report.mjs --packages server,client
 *   node scripts/deps-report.mjs --top 40             # rows in the heaviest table
 *   node scripts/deps-report.mjs --outdated --audit   # network lanes, opt-in
 *   node scripts/deps-report.mjs --no-size            # skip the disk walk (fast)
 *   node scripts/deps-report.mjs --fail-on p0         # exit 1 when a P0 finding exists
 *
 * Exit: 0 normally · 1 when --fail-on triggers · 2 on bad arguments.
 * Output is ANSI-free and stable enough to diff between two runs.
 */

import { readFileSync, readdirSync, existsSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { builtinModules } from 'node:module';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

// ---------------------------------------------------------------- arguments

const args = process.argv.slice(2);
let asJson = false;
let outFile = null;
let only = null;
let top = 25;
let withOutdated = false;
let withAudit = false;
let withSize = true;
let failOn = null;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--json') asJson = true;
  else if (a === '--out') outFile = args[++i];
  else if (a === '--packages') only = String(args[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  else if (a === '--top') top = Number(args[++i]);
  else if (a === '--outdated') withOutdated = true;
  else if (a === '--audit') withAudit = true;
  else if (a === '--no-size') withSize = false;
  else if (a === '--fail-on') failOn = String(args[++i] ?? '').toLowerCase();
  else if (a === '-h' || a === '--help') { usage(); process.exit(0); }
  else { console.error(`unknown argument: ${a}`); usage(); process.exit(2); }
}

if (!Number.isFinite(top) || top < 1 || (failOn && !['p0', 'p1', 'p2'].includes(failOn))) {
  usage();
  process.exit(2);
}

function usage() {
  console.error(
    'usage: node scripts/deps-report.mjs [--json] [--out <file>] [--packages a,b] [--top N]\n' +
    '                                    [--outdated] [--audit] [--no-size] [--fail-on p0|p1|p2]'
  );
}

// ---------------------------------------------------------------- constants

/** Tools that belong in devDependencies — a build/test concern, never shipped code. */
const DEV_TOOLS = new Set([
  'typescript', 'tsx', 'vitest', 'jsdom', 'postcss', 'tailwindcss', '@tailwindcss/postcss',
  'dependency-cruiser', 'drizzle-kit', 'testcontainers', '@testcontainers/postgresql',
  'pino-pretty', 'eslint', 'prettier', '@vitejs/plugin-react', 'gray-matter',
  '@testing-library/react', '@testing-library/jest-dom', 'esbuild', 'rimraf',
]);

/** Directories never worth walking for source imports or bytes. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.turbo', 'dist', 'build', 'coverage', 'clones',
  'test-results', 'results', 'snapshots', '.vercel', '.cache', 'migrations',
]);

const SRC_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const BUILTINS = new Set(builtinModules);
const MB = 1024 * 1024;

/** A prod dependency whose exclusive footprint passes this is worth a conscious decision. */
const HEAVY_PROD_BYTES = 5 * MB;

/**
 * Packages a framework loads for you: `next` renders through `react-dom` without
 * any file importing it. Their absence from the import scan proves nothing.
 */
const FRAMEWORK_IMPLICIT = new Set(['react', 'react-dom', 'next', 'sharp']);

// ---------------------------------------------------------------- utilities

const bytes = (n) => {
  if (n == null) return '—';
  if (n >= 1024 * MB) return `${(n / 1024 / MB).toFixed(2)} GB`;
  if (n >= MB) return `${(n / MB).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
};

/**
 * JSON with comments and trailing commas — tsconfig.json is not strict JSON.
 * Scanned character by character rather than by regex: a path alias like
 * `"@devdigest/shared/*"` contains a `/*` that any regex stripper eats.
 */
function readJsonc(file) {
  let raw;
  try { raw = readFileSync(file, 'utf8'); } catch { return null; }
  let out = '';
  let inString = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    const next = raw[i + 1];
    if (inString) {
      out += c;
      if (c === '\\') { out += next ?? ''; i++; }
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === '/' && next === '/') { while (i < raw.length && raw[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && next === '*') { i += 2; while (i < raw.length && !(raw[i] === '*' && raw[i + 1] === '/')) i++; i++; continue; }
    out += c;
  }
  try { return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1')); } catch { return null; }
}

const readJson = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };

function run(cmd, cwd) {
  const r = spawnSync(cmd, {
    cwd, shell: true, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}`, err: `${r.stderr ?? ''}` };
}

/** A legal npm package name — the guard that keeps prose out of the import scan. */
const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

/**
 * The package a bare specifier belongs to: `@scope/pkg/sub` → `@scope/pkg`.
 * The scan reads raw source, so a sentence inside a doc comment can reach here
 * through `from "…"`; anything not shaped like a package name is dropped.
 */
function specifierToPackage(spec) {
  if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) return null;
  const parts = spec.split('/');
  const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  if (!NPM_NAME.test(name)) return null;
  return BUILTINS.has(name) ? null : name;
}

/** The level at which two semver-ish ranges first differ. */
function driftLevel(rangeA, rangeB) {
  const norm = (r) => String(r).replace(/^[^0-9]*/, '').split('.').map((x) => parseInt(x, 10) || 0);
  const [a1, a2, a3] = norm(rangeA);
  const [b1, b2, b3] = norm(rangeB);
  if (a1 !== b1) return 'major';
  if (a2 !== b2) return 'minor';
  if (a3 !== b3) return 'patch';
  return null;
}

// ------------------------------------------------------------- 1. discovery

/** Every top-level directory holding a package.json — the independent packages. */
function discoverPackages() {
  const found = [];
  for (const e of readdirSync(ROOT, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
    const dir = join(ROOT, e.name);
    const manifest = readJson(join(dir, 'package.json'));
    if (!manifest) continue;
    const pm = existsSync(join(dir, 'pnpm-lock.yaml')) ? 'pnpm'
      : existsSync(join(dir, 'package-lock.json')) ? 'npm'
        : 'none';
    found.push({
      dir: e.name,
      path: dir,
      name: manifest.name ?? e.name,
      pm,
      lockfile: pm === 'pnpm' ? 'pnpm-lock.yaml' : pm === 'npm' ? 'package-lock.json' : null,
      installed: existsSync(join(dir, 'node_modules')),
      scripts: manifest.scripts ?? {},
      prodDeps: manifest.dependencies ?? {},
      devDeps: manifest.devDependencies ?? {},
      peerDeps: manifest.peerDependencies ?? {},
      optionalDeps: manifest.optionalDependencies ?? {},
      tsconfig: readJsonc(join(dir, 'tsconfig.json')),
    });
  }
  return found.sort((a, b) => a.dir.localeCompare(b.dir));
}

// ------------------------------------------------------- 2. installed bytes

/**
 * Walk a node_modules tree and measure every physical package copy.
 * Symlinks are skipped, which is what makes this correct under pnpm: the
 * top-level entries are links into `.pnpm`, so each version is counted once.
 */
function scanInstalled(nmDir, sink) {
  if (!existsSync(nmDir)) return;
  let entries;
  try { entries = readdirSync(nmDir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(nmDir, e.name);
    if (e.name === '.pnpm' && e.isDirectory()) {
      for (const store of readdirSync(p, { withFileTypes: true })) {
        if (store.isDirectory()) scanInstalled(join(p, store.name, 'node_modules'), sink);
      }
      continue;
    }
    if (e.name.startsWith('.') || e.isSymbolicLink() || !e.isDirectory()) continue;
    if (e.name.startsWith('@')) { scanInstalled(p, sink); continue; }
    recordPackageDir(p, sink);
  }
}

function recordPackageDir(dir, sink) {
  const pkg = readJson(join(dir, 'package.json'));
  if (pkg?.name) {
    const key = `${pkg.name}@${pkg.version ?? '0.0.0'}`;
    const size = measureDir(dir);
    const prev = sink.get(key);
    if (prev) {
      prev.bytes += size.bytes;
      prev.files += size.files;
      prev.copies += 1;
    } else {
      sink.set(key, {
        name: pkg.name,
        version: pkg.version ?? '0.0.0',
        bytes: size.bytes,
        files: size.files,
        copies: 1,
        hasInstallScript: Boolean(pkg.scripts?.install || pkg.scripts?.postinstall || pkg.scripts?.preinstall),
        bins: typeof pkg.bin === 'string' ? [pkg.name.split('/').pop()] : Object.keys(pkg.bin ?? {}),
        deprecated: typeof pkg.deprecated === 'string' ? pkg.deprecated : null,
        license: typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? null),
      });
    }
  }
  scanInstalled(join(dir, 'node_modules'), sink);
}

/** Bytes and file count of one package copy, excluding its nested node_modules. */
function measureDir(dir) {
  let total = 0;
  let files = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.isSymbolicLink()) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) { try { total += lstatSync(p).size; files++; } catch { /* raced */ } }
    }
  }
  return { bytes: total, files };
}

// --------------------------------------------------------- 3. resolved tree

/**
 * The installed graph as `name@version` nodes and parent→child edges.
 * Both package managers print the full subtree at every occurrence, so a node
 * is expanded once: the same version resolves to the same children.
 */
function resolveTree(pkg) {
  const empty = (error) => ({ nodes: new Map(), edges: new Map(), roots: new Map(), error });
  if (pkg.pm === 'none') return empty('no lockfile');
  if (!pkg.installed) return empty('node_modules missing — not installed');

  const cmd = pkg.pm === 'pnpm' ? 'pnpm ls --json --depth Infinity' : 'npm ls --json --all';
  const r = run(cmd, pkg.path);
  const start = r.out.search(/[[{]/);
  if (start < 0) return empty(`${pkg.pm} ls produced no JSON`);
  let parsed;
  try { parsed = JSON.parse(r.out.slice(start)); } catch { return empty(`${pkg.pm} ls output unparseable`); }
  const project = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!project) return empty('empty tree');

  const nodes = new Map();          // key -> {name, version}
  const edges = new Map();          // key -> Set(childKey)
  const roots = new Map();          // direct dep name -> key
  const versionByName = new Map();  // npm collapses a deduped entry to `{}`

  (function learn(obj) {
    for (const [name, node] of Object.entries(obj ?? {})) {
      if (node?.version) versionByName.set(name, node.version);
      if (node?.dependencies) learn(node.dependencies);
    }
  })({ ...(project.dependencies ?? {}), ...(project.devDependencies ?? {}) });

  const keyOf = (name, node) => {
    const v = node?.version ?? versionByName.get(name);
    return v ? `${name}@${v}` : null;
  };

  function walk(name, node, parentKey) {
    const key = keyOf(name, node);
    if (!key) return;
    if (parentKey) {
      if (!edges.has(parentKey)) edges.set(parentKey, new Set());
      edges.get(parentKey).add(key);
    }
    if (nodes.has(key)) return;
    nodes.set(key, { name, version: key.slice(name.length + 1) });
    for (const [childName, childNode] of Object.entries(node?.dependencies ?? {})) walk(childName, childNode, key);
  }

  for (const group of ['dependencies', 'devDependencies']) {
    for (const [name, node] of Object.entries(project[group] ?? {})) {
      const key = keyOf(name, node);
      if (key) roots.set(name, key);
      walk(name, node, null);
    }
  }
  return { nodes, edges, roots, error: null };
}

function reachable(edges, startKeys) {
  const seen = new Set();
  const stack = [...startKeys];
  while (stack.length) {
    const k = stack.pop();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    for (const c of edges.get(k) ?? []) stack.push(c);
  }
  return seen;
}

// -------------------------------------------------------- 4. source imports

function scanSource(pkg, packageDirs) {
  const specifiers = new Map();      // package name -> {runtime, testOnly, files:Set, runtimeFiles:Set}
  const aliasHits = new Map();       // alias prefix -> count
  const deepImports = [];            // relative imports that leave this package
  const configMentions = new Set();  // names quoted in a config file but never imported

  // An alias pointing into node_modules (`"zod": ["./node_modules/zod"]`) is a
  // resolution override, not an internal module — its imports stay npm imports.
  // `"@x/y"` matches only itself; `"@x/y/*"` matches only its subpaths — mixing
  // the two would credit every `@x/y` import to the wildcard entry.
  const aliasEntries = Object.entries(pkg.tsconfig?.compilerOptions?.paths ?? {})
    .filter(([, targets]) => !String(targets?.[0] ?? '').includes('node_modules'))
    .map(([alias]) => ({ key: alias.replace(/\*$/, ''), wildcard: alias.endsWith('*') }));

  const stack = [pkg.path];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) stack.push(p);
        continue;
      }
      if (!e.isFile()) continue;
      const dot = e.name.lastIndexOf('.');
      if (dot < 0 || !SRC_EXT.has(e.name.slice(dot))) continue;
      let src;
      try { src = readFileSync(p, 'utf8'); } catch { continue; }
      if (src.length > 2 * MB) continue;

      const rel = relative(pkg.path, p);
      const isConfig = /\.config\.[a-z]*[jt]s$/.test(rel) || /^\.?[a-z-]+\.(cjs|mjs|js|ts)$/.test(rel);
      const testish = /(^|[\\/])(test|tests|__tests__|specs?|scripts|fixtures)[\\/]/.test(rel)
        || /\.(test|spec|cases|eval)\.[tj]sx?$/.test(rel)
        || isConfig;

      // `postcss.config.mjs` names its plugins as strings; `vitest.config.ts` picks
      // `environment: 'jsdom'`. Neither is an import, both are real usage.
      if (isConfig) {
        for (const m of src.matchAll(/['"]([@a-z0-9][\w@/.-]*)['"]/g)) {
          if (NPM_NAME.test(m[1])) configMentions.add(m[1]);
        }
      }

      for (const re of [
        /\bfrom\s*['"]([^'"]+)['"]/g,
        /\bimport\s*\(\s*(?:\/\*[\s\S]*?\*\/\s*)?['"]([^'"]+)['"]/g,
        /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
        /\bimport\s+['"]([^'"]+)['"]/g,
      ]) {
        let m;
        while ((m = re.exec(src))) {
          const spec = m[1];

          // A relative path that leaves the package reaches into another
          // package's internals — the alias exists precisely to prevent this.
          if (spec.startsWith('.')) {
            const target = relative(ROOT, resolve(dirname(p), spec));
            const head = target.split(sep)[0];
            if (!target.startsWith('..') && head !== pkg.dir && packageDirs.has(head)) {
              deepImports.push({ from: rel, to: target, targetPackage: head, testOnly: testish });
            }
            continue;
          }

          const alias = aliasEntries.find((a) => (a.wildcard ? spec.startsWith(a.key) && spec !== a.key : spec === a.key));
          if (alias) {
            aliasHits.set(alias.key, (aliasHits.get(alias.key) ?? 0) + 1);
            continue;
          }
          const name = specifierToPackage(spec);
          if (!name) continue;
          const hit = specifiers.get(name) ?? { runtime: 0, testOnly: 0, files: new Set(), runtimeFiles: new Set() };
          hit[testish ? 'testOnly' : 'runtime'] += 1;
          if (hit.files.size < 5) hit.files.add(rel);
          if (!testish && hit.runtimeFiles.size < 5) hit.runtimeFiles.add(rel);
          specifiers.set(name, hit);
        }
      }
    }
  }
  return { specifiers, aliasHits, deepImports, configMentions };
}

/**
 * A dep with no import can still be legitimately used — say why we cannot see it.
 * `bins` are the executables the installed package actually publishes, which is
 * how `typescript` (ships `tsc`) stops reading as unused.
 */
function unreferencedReason(name, pkg, bins = [], configMentions = new Set()) {
  if (name.startsWith('@types/')) return 'types-only (ambient)';
  if (FRAMEWORK_IMPLICIT.has(name)) return 'loaded by the framework, not by an import';
  if (configMentions.has(name) || configMentions.has(name.split('/').pop())) return 'named in a config file, not imported';
  const candidates = [name, name.split('/').pop(), ...bins];
  const scripts = Object.values(pkg.scripts).map(String);
  if (candidates.some((c) => c && scripts.some((s) => new RegExp(`(^|[\\s"'/=])${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s"'/,;)]|$)`).test(s)))) {
    return 'run from a package script';
  }
  if (DEV_TOOLS.has(name)) return 'tooling, no import and no script';
  return 'no import found in source';
}

// -------------------------------------------------------- 5. internal graph

/** tsconfig path aliases turned into package→package edges. */
function internalEdges(packages, scans) {
  const byDir = new Set(packages.map((p) => p.dir));
  const edges = [];
  for (const pkg of packages) {
    const paths = pkg.tsconfig?.compilerOptions?.paths ?? {};
    const baseUrl = pkg.tsconfig?.compilerOptions?.baseUrl ?? '.';
    for (const [alias, targets] of Object.entries(paths)) {
      const abs = resolve(pkg.path, baseUrl, String(targets?.[0] ?? ''));
      const relFromRoot = relative(ROOT, abs);
      const head = relFromRoot.split(sep)[0];
      const owner = byDir.has(head) ? head : 'external';
      const prefix = alias.replace(/\*$/, '');
      edges.push({
        from: pkg.dir,
        to: owner,
        alias,
        target: relFromRoot,
        imports: scans.get(pkg.dir)?.aliasHits.get(prefix) ?? 0,
        selfContained: owner === pkg.dir,
      });
    }
  }
  return edges;
}

/** `@devdigest/shared` exists twice on purpose — measure how far the copies have drifted. */
function vendorMirror() {
  const a = join(ROOT, 'server', 'src', 'vendor', 'shared');
  const b = join(ROOT, 'client', 'src', 'vendor', 'shared');
  if (!existsSync(a) || !existsSync(b)) return null;
  const list = (base) => {
    const out = new Map();
    const stack = [base];
    while (stack.length) {
      const d = stack.pop();
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) stack.push(p);
        else if (e.isFile()) out.set(relative(base, p), readFileSync(p, 'utf8'));
      }
    }
    return out;
  };
  const A = list(a);
  const B = list(b);
  return {
    serverFiles: A.size,
    clientFiles: B.size,
    onlyServer: [...A.keys()].filter((f) => !B.has(f)).sort(),
    onlyClient: [...B.keys()].filter((f) => !A.has(f)).sort(),
    differing: [...A.keys()].filter((f) => B.has(f) && B.get(f) !== A.get(f)).sort(),
  };
}

// ------------------------------------------------------------ 6. build model

const allPackages = discoverPackages();
const packageDirs = new Set(allPackages.map((p) => p.dir));
const packages = allPackages.filter((p) => !only || only.includes(p.dir));
if (packages.length === 0) { console.error('no packages matched'); process.exit(2); }

const scans = new Map();
const installedIndex = new Map(); // package dir -> Map(name@version -> measured metadata)
const findings = [];
const addFinding = (severity, category, subject, evidence, hint) =>
  findings.push({ id: `${category}-${findings.length + 1}`, severity, category, subject, evidence, hint });

const model = {
  generatedAt: new Date().toISOString().slice(0, 10),
  node: process.version,
  packages: [],
  repo: {},
  findings: [],
};

for (const pkg of packages) {
  const sizes = new Map();
  if (withSize && pkg.installed) scanInstalled(join(pkg.path, 'node_modules'), sizes);
  const tree = resolveTree(pkg);
  const scan = scanSource(pkg, packageDirs);
  scans.set(pkg.dir, scan);
  installedIndex.set(pkg.dir, sizes);

  const sizeOf = (keys) => {
    let total = 0;
    let unmeasured = 0;
    for (const k of keys) {
      const s = sizes.get(k);
      if (s) total += s.bytes;
      else unmeasured++;
    }
    return { bytes: withSize ? total : null, unmeasured };
  };

  const prodRootKeys = Object.keys(pkg.prodDeps).map((n) => tree.roots.get(n)).filter(Boolean);
  const devRootKeys = Object.keys(pkg.devDeps).map((n) => tree.roots.get(n)).filter(Boolean);
  const allRootKeys = [...prodRootKeys, ...devRootKeys];
  const prodSet = reachable(tree.edges, prodRootKeys);
  const devOnly = new Set([...reachable(tree.edges, devRootKeys)].filter((k) => !prodSet.has(k)));

  // Per direct dependency: its subtree, and the slice of it nothing else pulls in.
  const directs = [];
  for (const kind of ['prod', 'dev']) {
    const source = kind === 'prod' ? pkg.prodDeps : pkg.devDeps;
    for (const [name, declared] of Object.entries(source)) {
      const key = tree.roots.get(name);
      const own = key ? reachable(tree.edges, [key]) : new Set();
      const others = reachable(tree.edges, allRootKeys.filter((k) => k !== key));
      const exclusive = new Set([...own].filter((k) => !others.has(k)));
      const usage = scan.specifiers.get(name);
      directs.push({
        name,
        declared,
        resolved: key ? key.slice(name.length + 1) : null,
        kind,
        subtree: own.size,
        exclusive: exclusive.size,
        bytes: sizeOf(own).bytes,
        exclusiveBytes: sizeOf(exclusive).bytes,
        imports: usage ? usage.runtime + usage.testOnly : 0,
        runtimeImports: usage?.runtime ?? 0,
        sampleFiles: usage ? [...usage.files] : [],
      });
    }
  }
  directs.sort((a, b) => (b.exclusiveBytes ?? 0) - (a.exclusiveBytes ?? 0));

  // Same name installed at two versions inside one tree.
  const versionsByName = new Map();
  for (const [key, node] of tree.nodes) {
    const list = versionsByName.get(node.name) ?? [];
    list.push({ key, version: node.version, bytes: sizes.get(key)?.bytes ?? 0 });
    versionsByName.set(node.name, list);
  }
  const duplicates = [...versionsByName.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([name, list]) => {
      const sorted = [...list].sort((a, b) => b.bytes - a.bytes);
      return {
        name,
        versions: list.map((l) => l.version).sort(),
        wastedBytes: withSize ? sorted.slice(1).reduce((s, l) => s + l.bytes, 0) : null,
      };
    })
    .sort((a, b) => (b.wastedBytes ?? 0) - (a.wastedBytes ?? 0));

  const meta = (key) => sizes.get(key);
  const installScripts = [...tree.nodes.keys()].map(meta).filter((s) => s?.hasInstallScript)
    .map((s) => ({ name: s.name, version: s.version, bytes: s.bytes }))
    .sort((a, b) => b.bytes - a.bytes);
  const deprecated = [...tree.nodes.keys()].map(meta).filter((s) => s?.deprecated)
    .map((s) => ({ name: s.name, version: s.version, message: s.deprecated.slice(0, 160) }));

  const unreferenced = directs
    .filter((d) => d.imports === 0)
    .map((d) => ({
      name: d.name,
      kind: d.kind,
      bytes: d.exclusiveBytes,
      reason: unreferencedReason(d.name, pkg, sizes.get(`${d.name}@${d.resolved}`)?.bins ?? [], scan.configMentions),
    }));

  const declaredNames = new Set([
    ...Object.keys(pkg.prodDeps), ...Object.keys(pkg.devDeps),
    ...Object.keys(pkg.peerDeps), ...Object.keys(pkg.optionalDeps),
  ]);
  // Only a name that is actually installed can be a phantom dependency. A
  // specifier that resolves to nothing on disk is a fixture string or a doc
  // comment example — the import scan reads raw source and cannot tell them
  // apart, but the filesystem can.
  const installedNames = new Set([...sizes.values()].map((s) => s.name));
  for (const node of tree.nodes.values()) installedNames.add(node.name);
  const undeclared = [...scan.specifiers.entries()]
    .filter(([name]) => !declaredNames.has(name) && installedNames.has(name))
    .map(([name, hit]) => ({
      name,
      imports: hit.runtime + hit.testOnly,
      runtimeImports: hit.runtime,
      files: [...hit.files],
      runtimeFiles: [...hit.runtimeFiles],
    }))
    .sort((a, b) => b.imports - a.imports);

  const misplaced = Object.keys(pkg.prodDeps)
    .filter((n) => !FRAMEWORK_IMPLICIT.has(n))
    .filter((n) => DEV_TOOLS.has(n) || (scan.specifiers.get(n)?.runtime ?? 0) === 0)
    .map((n) => ({
      name: n,
      reason: DEV_TOOLS.has(n) ? 'build/test tooling in `dependencies`' : 'no non-test import in source',
      bytes: directs.find((d) => d.name === n)?.exclusiveBytes ?? null,
    }));

  const treeKeys = new Set(tree.nodes.keys());
  model.packages.push({
    dir: pkg.dir,
    name: pkg.name,
    pm: pkg.pm,
    lockfile: pkg.lockfile,
    installed: pkg.installed,
    treeError: tree.error,
    counts: {
      directProd: Object.keys(pkg.prodDeps).length,
      directDev: Object.keys(pkg.devDeps).length,
      resolvedTotal: tree.nodes.size,
      prodReachable: prodSet.size,
      devOnly: devOnly.size,
    },
    size: withSize ? {
      installedBytes: [...sizes.values()].reduce((s, v) => s + v.bytes, 0),
      prodBytes: sizeOf(prodSet).bytes,
      devOnlyBytes: sizeOf(devOnly).bytes,
      unmeasured: sizeOf(treeKeys).unmeasured,
    } : null,
    directs,
    duplicates,
    installScripts,
    deprecated,
    unreferenced,
    undeclared,
    misplaced,
    deepImports: scan.deepImports,
    aliases: Object.keys(pkg.tsconfig?.compilerOptions?.paths ?? {}),
  });

  // ---- mechanical findings
  // Two majors of a library we declare ourselves is a decision we made wrong;
  // two majors deep in someone else's subtree is ordinary npm and costs bytes.
  const directNames = new Set(directs.map((d) => d.name));
  for (const d of duplicates) {
    const spread = driftLevel(d.versions[0], d.versions[d.versions.length - 1]);
    const ours = directNames.has(d.name);
    if (spread === 'major' && ours && !d.name.startsWith('@types/')) {
      addFinding('p0', 'duplicate-major', `${pkg.dir} → ${d.name}`,
        `declared here and installed at ${d.versions.join(', ')} in one tree (${bytes(d.wastedBytes)} of extra copies)`,
        'two majors of a library we declare ourselves — align the ranges or isolate the consumer');
    } else if (spread === 'major' && (d.wastedBytes ?? 0) > MB) {
      addFinding('p2', 'duplicate-major-transitive', `${pkg.dir} → ${d.name}`,
        `${d.versions.join(', ')} pulled in by different parents (${bytes(d.wastedBytes)} of extra copies)`,
        'ordinary npm resolution — worth deduping only for the bytes, or when both copies hold state');
    } else if ((d.wastedBytes ?? 0) > 2 * MB) {
      addFinding('p2', 'duplicate-minor', `${pkg.dir} → ${d.name}`,
        `versions ${d.versions.join(', ')}, ${bytes(d.wastedBytes)} duplicated`,
        'dedupe by widening the range in whichever dependency pins it');
    }
  }
  for (const m of misplaced) {
    addFinding('p1', 'misplaced-dep', `${pkg.dir}/package.json → ${m.name}`, `${m.reason} (${bytes(m.bytes)})`,
      'move to devDependencies — today it is installed in every production install');
  }
  for (const u of unreferenced) {
    if (u.reason === 'no import found in source' || u.reason === 'tooling, no import and no script') {
      addFinding('p1', 'unreferenced-dep', `${pkg.dir}/package.json → ${u.name}`, `${u.reason} (${bytes(u.bytes)})`,
        'confirm by hand, then propose removing it — a dependency nothing references is install cost and attack surface');
    }
  }
  for (const u of undeclared) {
    if (u.runtimeImports > 0) {
      addFinding('p0', 'undeclared-dep', `${pkg.dir} → ${u.name}`,
        `imported in ${u.runtimeImports} non-test file(s), e.g. ${pkg.dir}/${u.runtimeFiles[0] ?? u.files[0] ?? '?'}, but declared in no package.json`,
        'declare it — it resolves today only through a transitive install that can vanish on any update');
    }
  }
  const runtimeDeep = scan.deepImports.filter((d) => !d.testOnly);
  for (const target of new Set(runtimeDeep.map((d) => d.targetPackage))) {
    const hits = runtimeDeep.filter((d) => d.targetPackage === target);
    addFinding('p0', 'boundary-bypass', `${pkg.dir} → ${target}`,
      `${hits.length} relative import(s) into another package's internals, e.g. ${pkg.dir}/${hits[0].from} → ${hits[0].to}`,
      `import through the public entry point (the tsconfig alias) instead — a relative path pins one file's location forever`);
  }
  for (const d of directs) {
    if (d.kind === 'prod' && (d.exclusiveBytes ?? 0) > HEAVY_PROD_BYTES) {
      addFinding('p2', 'heavy-prod-dep', `${pkg.dir} → ${d.name}`,
        `${bytes(d.exclusiveBytes)} exclusive across ${d.exclusive} package(s), ${d.imports} import site(s)`,
        d.imports <= 2
          ? 'few call sites for this weight — check whether the part actually used can be inlined'
          : 'the weight is earned only if the API surface used is broad');
    }
  }
  for (const d of deprecated) {
    addFinding('p1', 'deprecated', `${pkg.dir} → ${d.name}@${d.version}`, d.message, 'upgrade the parent that pins it');
  }
  if (tree.error) {
    addFinding('p1', 'no-tree', pkg.dir, tree.error,
      `run the install (${pkg.pm === 'npm' ? 'npm ci' : 'pnpm install'}) before trusting this package's numbers`);
  }
}

// ------------------------------------------------- 7. repo-wide correlation

const declaredAcross = new Map();
for (const pkg of packages) {
  const rendered = model.packages.find((p) => p.dir === pkg.dir);
  for (const kind of ['prod', 'dev']) {
    for (const [name, range] of Object.entries(kind === 'prod' ? pkg.prodDeps : pkg.devDeps)) {
      const entry = declaredAcross.get(name) ?? [];
      entry.push({ pkg: pkg.dir, range, kind, resolved: rendered?.directs.find((d) => d.name === name)?.resolved ?? null });
      declaredAcross.set(name, entry);
    }
  }
}

const shared = [...declaredAcross.entries()]
  .filter(([, uses]) => uses.length > 1)
  .map(([name, uses]) => {
    const ranges = [...new Set(uses.map((u) => u.range))];
    let drift = null;
    for (let i = 1; i < ranges.length; i++) {
      const level = driftLevel(ranges[0], ranges[i]);
      if (level === 'major' || (level === 'minor' && drift !== 'major') || (level && !drift)) drift = level;
    }
    // Ranges can agree while the installs do not: six lockfiles resolve `^22.10.0`
    // on six different days.
    const resolvedVersions = [...new Set(uses.map((u) => u.resolved).filter(Boolean))];
    let resolvedDrift = null;
    for (let i = 1; i < resolvedVersions.length; i++) {
      const level = driftLevel(resolvedVersions[0], resolvedVersions[i]);
      if (level === 'major' || (level === 'minor' && resolvedDrift !== 'major') || (level && !resolvedDrift)) resolvedDrift = level;
    }
    return { name, uses, ranges, resolvedVersions, drift, resolvedDrift };
  })
  .sort((a, b) => b.uses.length - a.uses.length || a.name.localeCompare(b.name));

for (const s of shared) {
  const where = s.uses.map((u) => `${u.pkg}/package.json ${u.range}`).join(' · ');
  if (s.drift === 'major') {
    addFinding('p0', 'version-drift', s.name, `${where} — different majors declared`,
      'one major per repo unless a package is deliberately isolated; a wire-crossing type built by two majors is a runtime bug, not a lint');
  } else if (s.drift === 'minor') {
    addFinding('p1', 'version-drift', s.name, `${where} — minor drift in the declared ranges`,
      'align the ranges in one PR so every CI lane tests the same code');
  } else if (s.resolvedDrift === 'major') {
    addFinding('p1', 'resolved-drift', s.name,
      `same range everywhere, but installed as ${s.resolvedVersions.join(', ')} across ${s.uses.map((u) => u.pkg).join(', ')}`,
      'six lockfiles resolved on six different days — refresh them together, or pin the shared library');
  } else if (s.resolvedVersions.length > 1) {
    addFinding('info', 'resolved-drift', s.name,
      `installed as ${s.resolvedVersions.join(', ')} across ${s.uses.map((u) => u.pkg).join(', ')} from the same range`,
      'expected with six independent lockfiles — worth a refresh only when a bug tracks a version');
  }
}

const mirror = vendorMirror();
if (mirror && (mirror.differing.length || mirror.onlyServer.length || mirror.onlyClient.length)) {
  addFinding('p1', 'vendor-drift', 'server/src/vendor/shared ↔ client/src/vendor/shared',
    `${mirror.differing.length} file(s) differ, ${mirror.onlyServer.length} server-only, ${mirror.onlyClient.length} client-only`,
    'the client copy is a trimmed mirror by design — confirm every wire-crossing contract is identical in both');
}

/**
 * Six independent installs mean one library can sit on disk six times. This is
 * the price of "not a monorepo" in bytes — informational, not a defect.
 */
function crossPackageCopies() {
  const byName = new Map();
  for (const [dir, sizes] of installedIndex) {
    for (const meta of sizes.values()) {
      const entry = byName.get(meta.name) ?? { name: meta.name, installs: [], versions: new Set() };
      entry.installs.push({ pkg: dir, version: meta.version, bytes: meta.bytes });
      entry.versions.add(meta.version);
      byName.set(meta.name, entry);
    }
  }
  return [...byName.values()]
    .filter((e) => new Set(e.installs.map((i) => i.pkg)).size > 1)
    .map((e) => {
      const total = e.installs.reduce((s, i) => s + i.bytes, 0);
      const largest = Math.max(...e.installs.map((i) => i.bytes));
      return {
        name: e.name,
        packages: [...new Set(e.installs.map((i) => i.pkg))],
        versions: [...e.versions].sort(),
        totalBytes: total,
        redundantBytes: total - largest,
      };
    })
    .sort((a, b) => b.redundantBytes - a.redundantBytes);
}

model.repo = {
  packages: model.packages.length,
  installedBytes: withSize ? model.packages.reduce((s, p) => s + (p.size?.installedBytes ?? 0), 0) : null,
  totalResolved: model.packages.reduce((s, p) => s + p.counts.resolvedTotal, 0),
  sharedDependencies: shared,
  crossPackageCopies: withSize ? crossPackageCopies() : [],
  internalEdges: internalEdges(packages, scans),
  vendorMirror: mirror,
};

// -------------------------------------------------------- 8. network lanes

if (withOutdated || withAudit) {
  for (const pkg of packages) {
    const target = model.packages.find((p) => p.dir === pkg.dir);
    if (!pkg.installed) continue;

    if (withOutdated) {
      const r = run(pkg.pm === 'pnpm' ? 'pnpm outdated --format json' : 'npm outdated --json', pkg.path);
      const start = r.out.indexOf('{');
      try {
        const parsed = JSON.parse(r.out.slice(start));
        target.outdated = Object.entries(parsed).map(([name, info]) => ({
          name,
          current: info.current ?? info.currentVersion ?? null,
          wanted: info.wanted ?? info.wantedVersion ?? null,
          latest: info.latest ?? info.latestVersion ?? null,
        }));
        for (const o of target.outdated) {
          if (o.current && o.latest && driftLevel(o.current, o.latest) === 'major') {
            addFinding('p2', 'major-behind', `${pkg.dir} → ${o.name}`, `${o.current} → ${o.latest} available`,
              'a major upgrade is a scheduled task, not a drive-by — record it, do not do it here');
          }
        }
      } catch { target.outdated = { error: 'could not read outdated output' }; }
    }

    if (withAudit) {
      const r = run(pkg.pm === 'pnpm' ? 'pnpm audit --json' : 'npm audit --json', pkg.path);
      const start = r.out.indexOf('{');
      try {
        const parsed = JSON.parse(r.out.slice(start));
        const vulns = parsed.vulnerabilities ?? parsed.advisories ?? {};
        target.audit = Object.entries(vulns).map(([name, v]) => ({
          name,
          severity: v.severity ?? 'unknown',
          via: Array.isArray(v.via) ? v.via.map((x) => (typeof x === 'string' ? x : x?.title)).filter(Boolean).slice(0, 3) : [],
          fixAvailable: v.fixAvailable ?? null,
        }));
        for (const v of target.audit) {
          if (['critical', 'high'].includes(String(v.severity))) {
            addFinding('p0', 'vulnerability', `${pkg.dir} → ${v.name}`,
              `${v.severity}: ${v.via.join('; ') || 'see audit output'}`,
              v.fixAvailable ? 'a fix exists — take it in its own PR' : 'no fix published — decide between pinning, patching or replacing');
          }
        }
      } catch { target.audit = { error: 'could not read audit output' }; }
    }
  }
}

/** The tiers the report speaks in: P0 broken · P1 wrong-but-working · P2 weight · Info context. */
const RANK = { p0: 0, p1: 1, p2: 2, info: 3 };
const SEV = { p0: 'P0', p1: 'P1', p2: 'P2', info: 'Info' };
model.findings = findings.sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.category.localeCompare(b.category));

// ------------------------------------------------------------- 9. rendering

function mermaid() {
  const id = (dir) => dir.replace(/[^A-Za-z0-9]/g, '_');
  const lines = ['```mermaid', 'flowchart LR'];
  for (const p of model.packages) {
    const size = p.size?.installedBytes ? ` · ${bytes(p.size.installedBytes)}` : '';
    lines.push(`  ${id(p.dir)}["${p.dir}<br/>${p.counts.directProd}+${p.counts.directDev} direct · ${p.counts.resolvedTotal} resolved${size}"]`);
  }
  const seen = new Set();
  for (const e of model.repo.internalEdges) {
    if (e.selfContained || e.to === 'external') continue;
    const edgeId = `${e.from}->${e.to}:${e.alias}`;
    if (seen.has(edgeId)) continue;
    seen.add(edgeId);
    lines.push(`  ${id(e.from)} -->|"${e.alias}${e.imports ? ` ×${e.imports}` : ''}"| ${id(e.to)}`);
  }
  lines.push('```');
  return lines.join('\n');
}

function markdown() {
  const L = [];
  const count = (s) => model.findings.filter((f) => f.severity === s).length;

  L.push(`# Dependency report — ${model.generatedAt}`, '');
  L.push(`Node ${model.node} · ${model.repo.packages} packages · ${model.repo.totalResolved} resolved dependency instances · ${bytes(model.repo.installedBytes)} on disk · findings: ${count('p0')} P0 / ${count('p1')} P1 / ${count('p2')} P2 / ${count('info')} Info`, '');

  L.push('## 1. Scope', '');
  L.push('Every package analysed, with what it declares and what that costs on disk. These packages are **not** a workspace: each has its own `package.json` and its own lockfile, and they share code through TypeScript path aliases rather than `workspace:*` links.', '');
  L.push('| Package | PM | Lockfile | Direct prod | Direct dev | Resolved | Prod-reachable | Dev-only | Prod size | Dev-only size | On disk | Unattributed |');
  L.push('|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const p of model.packages) {
    const rest = p.size ? p.size.installedBytes - (p.size.prodBytes ?? 0) - (p.size.devOnlyBytes ?? 0) : null;
    L.push(`| \`${p.dir}\` (${p.name}) | ${p.pm} | ${p.lockfile ?? '—'} | ${p.counts.directProd} | ${p.counts.directDev} | ${p.counts.resolvedTotal} | ${p.counts.prodReachable} | ${p.counts.devOnly} | ${bytes(p.size?.prodBytes)} | ${bytes(p.size?.devOnlyBytes)} | ${bytes(p.size?.installedBytes)} | ${bytes(rest)} |`);
  }
  L.push('');
  L.push('`Unattributed` is on disk but outside the resolved tree — optional platform binaries, peer installs and stale copies. A large value means the lockfile and `node_modules` have drifted apart.', '');

  L.push('## 2. Internal dependency graph', '');
  L.push('Internal edges are **path aliases**, not npm packages — nothing here is installed from a registry.', '');
  L.push(mermaid(), '');
  L.push('| From | To | Alias | Target | Import sites |');
  L.push('|---|---|---|---|---:|');
  for (const e of model.repo.internalEdges) {
    L.push(`| \`${e.from}\` | ${e.selfContained ? '(self)' : `\`${e.to}\``} | \`${e.alias}\` | \`${e.target}\` | ${e.imports} |`);
  }
  L.push('');
  const deep = model.packages.flatMap((p) => p.deepImports.map((d) => ({ ...d, pkg: p.dir })));
  if (deep.length) {
    L.push('**Relative imports crossing a package boundary** — these bypass the public entry point the alias exists to provide:', '');
    L.push('| From file | Reaches into | Test-only |');
    L.push('|---|---|---|');
    for (const d of deep.slice(0, top)) L.push(`| \`${d.pkg}/${d.from}\` | \`${d.to}\` | ${d.testOnly ? 'yes' : '**no**'} |`);
    L.push('');
  }
  if (model.repo.vendorMirror) {
    const m = model.repo.vendorMirror;
    L.push(`**\`@devdigest/shared\` mirror** — server ${m.serverFiles} files, client ${m.clientFiles} files · ${m.differing.length} differing · ${m.onlyServer.length} server-only · ${m.onlyClient.length} client-only.`);
    if (m.differing.length) L.push('', `Differing: ${m.differing.map((f) => `\`${f}\``).join(', ')}`);
    L.push('');
  }

  L.push('## 3. Weight — heaviest direct dependencies', '');
  L.push('`Exclusive` is what disappears with the dependency: the packages nothing else pulls in.', '');
  L.push('| Package | Dependency | Kind | Declared | Resolved | Subtree | Exclusive | Exclusive size | Import sites |');
  L.push('|---|---|---|---|---|---:|---:|---:|---:|');
  const allDirects = model.packages.flatMap((p) => p.directs.map((d) => ({ ...d, pkg: p.dir })));
  for (const d of allDirects.sort((a, b) => (b.exclusiveBytes ?? 0) - (a.exclusiveBytes ?? 0)).slice(0, top)) {
    L.push(`| \`${d.pkg}\` | \`${d.name}\` | ${d.kind} | \`${d.declared}\` | ${d.resolved ?? '—'} | ${d.subtree} | ${d.exclusive} | ${bytes(d.exclusiveBytes)} | ${d.imports} |`);
  }
  L.push('');

  L.push('## 4. Shared across packages', '');
  L.push('| Dependency | Packages | Ranges | Resolved | Drift |');
  L.push('|---|---|---|---|---|');
  for (const s of model.repo.sharedDependencies) {
    L.push(`| \`${s.name}\` | ${s.uses.map((u) => `${u.pkg}(${u.kind})`).join(', ')} | ${s.ranges.map((r) => `\`${r}\``).join(', ')} | ${s.resolvedVersions.join(', ') || '—'} | ${s.drift ?? 'aligned'} |`);
  }
  L.push('');

  if (model.repo.crossPackageCopies.length) {
    L.push('## 5. The same library installed by several packages', '');
    L.push('Six independent installs, six copies. `Redundant` is what a workspace would save — a fact about the repo layout, not a defect.', '');
    L.push('| Dependency | Packages | Versions | Total on disk | Redundant |');
    L.push('|---|---|---|---:|---:|');
    for (const c of model.repo.crossPackageCopies.slice(0, top)) {
      L.push(`| \`${c.name}\` | ${c.packages.join(', ')} | ${c.versions.join(', ')} | ${bytes(c.totalBytes)} | ${bytes(c.redundantBytes)} |`);
    }
    const totalRedundant = model.repo.crossPackageCopies.reduce((s, c) => s + c.redundantBytes, 0);
    L.push('', `Across every shared library: **${bytes(totalRedundant)}** of duplicated install.`, '');
  }

  L.push('## 6. Hygiene', '');
  for (const p of model.packages) {
    const rows = [];
    for (const m of p.misplaced) rows.push(`misplaced · \`${m.name}\` — ${m.reason}`);
    for (const u of p.unreferenced) rows.push(`unreferenced · \`${u.name}\` (${u.kind}) — ${u.reason}`);
    for (const u of p.undeclared) rows.push(`undeclared · \`${u.name}\` — ${u.imports} import site(s), e.g. \`${u.files[0] ?? '?'}\``);
    for (const d of p.duplicates.slice(0, 5)) rows.push(`duplicate · \`${d.name}\` at ${d.versions.join(', ')} (${bytes(d.wastedBytes)} extra)`);
    for (const s of p.installScripts.slice(0, 5)) rows.push(`install script · \`${s.name}@${s.version}\` (${bytes(s.bytes)}) runs code at install time`);
    for (const d of p.deprecated.slice(0, 5)) rows.push(`deprecated · \`${d.name}@${d.version}\` — ${d.message}`);
    if (p.outdated?.length) rows.push(`outdated · ${p.outdated.length} package(s) behind latest`);
    if (rows.length) {
      L.push(`**\`${p.dir}\`**`, '');
      for (const r of rows) L.push(`- ${r}`);
      L.push('');
    }
  }

  L.push('## 7. Findings & Priorities', '');
  L.push('P0 — the graph contradicts itself or ships a known vulnerability · P1 — wrong but working · P2 — weight and drift · Info — context, no action implied.', '');
  for (const tier of ['p0', 'p1', 'p2', 'info']) {
    const rows = model.findings.filter((f) => f.severity === tier);
    if (!rows.length) continue;
    L.push(`### ${SEV[tier]} (${rows.length})`, '');
    L.push('| # | Category | Subject | Evidence | Direction |');
    L.push('|---|---|---|---|---|');
    for (const f of rows) L.push(`| ${f.id} | ${f.category} | ${f.subject} | ${f.evidence} | ${f.hint} |`);
    L.push('');
  }
  if (!model.findings.length) L.push('Nothing mechanical to report.', '');

  L.push('## 8. Summary', '');
  L.push('Mechanical ordering — severity first, then evidence size. Nothing below has been changed; each line is a proposal to confirm.', '');
  const summary = model.findings.filter((f) => f.severity !== 'info').slice(0, 5);
  if (summary.length) {
    summary.forEach((f, i) => L.push(`${i + 1}. **${SEV[f.severity]} · ${f.subject}** — ${f.evidence}. ${f.hint}.`));
  } else {
    L.push('No P0/P1/P2 finding — the dependency graph is internally consistent as measured.');
  }
  L.push('', '---', '');
  L.push('Generated by `node scripts/deps-report.mjs` — facts only. Judgement, ordering and the fix plan belong to the reader, or to `.claude/skills/dependency-checker/SKILL.md`.');
  return L.join('\n');
}

const output = asJson
  ? JSON.stringify(model, (_k, v) => (v instanceof Set ? [...v] : v), 2)
  : markdown();

if (outFile) {
  const dest = resolve(ROOT, outFile);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, output.endsWith('\n') ? output : `${output}\n`);
  console.error(`written: ${relative(ROOT, dest)}`);
} else {
  process.stdout.write(`${output}\n`);
}

if (failOn && model.findings.some((f) => RANK[f.severity] <= RANK[failOn])) process.exit(1);
