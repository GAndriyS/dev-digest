/**
 * UI-architecture boundaries for @devdigest/web. Machine enforcement for the
 * placement rules written up in `.claude/skills/frontend-ui-architecture/SKILL.md`
 * — prose and CI must agree.
 *
 * Run:  pnpm exec depcruise src --config .dependency-cruiser.cjs
 *
 * Scope note: dependency-cruiser reasons about the MODULE GRAPH, so it can only
 * enforce rules that are edges between files — who may import whom. Two rules in
 * the skill are syntax-level, not graph-level (`export *` in a barrel, and a raw
 * `fetch()` call outside `lib/api.ts`), so they live in `scripts/check-ui-conventions.mjs`
 * instead. Both run in the same CI step; neither is optional.
 *
 * `pathNot` lists marked GRANDFATHERED are debt, not policy. Shrink them; never
 * append. Everything else is a boundary: fix the import direction, not the rule.
 */

/**
 * Vendored trees. `vendor/ui` is a UI kit copied in wholesale and `vendor/shared`
 * is a trimmed copy of the server's contracts — both are fixed upstream and
 * re-vendored, so their internal shape is not ours to police. They are still
 * cruised as TARGETS (the leaf rules below), just not as sources.
 */
const VENDOR = '^src/vendor/';

module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'A runtime import cycle in UI code almost always means a module imported its own ' +
        "barrel instead of a sibling by path (`from '.'` rather than `from './Thing'`). " +
        'Import the sibling directly. Type-only cycles are exempt: they erase at compile time.',
      from: {},
      // viaOnly, not dependencyTypesNot: a cycle is only reported when EVERY edge
      // in it survives at runtime. One `import type` link is enough to break it.
      to: { circular: true, viaOnly: { dependencyTypesNot: ['type-only'] } },
    },

    // ---- The placement ladder ------------------------------------------------
    {
      name: 'no-cross-route-internals',
      severity: 'error',
      comment:
        "Another route tree's code is private. Reaching sideways from src/app/<a>/ into " +
        'src/app/<b>/ is the moment shared code was needed: promote the piece to ' +
        'src/components/<name>/ (UI) or src/lib/ (logic) and import it from both. Inside one ' +
        'route tree this is legal — a nested page may use its ancestor\'s _components/.',
      from: { path: '^src/app/([^/]+)/' },
      to: { path: '^src/app/([^/]+)/', pathNot: ['^src/app/$1/'] },
    },
    {
      name: 'shared-does-not-know-features',
      severity: 'error',
      comment:
        'src/components/ and src/lib/ are the shared layer: every route may depend on them, ' +
        'so they may depend on no route. An import from src/app/ here means the module is ' +
        'not actually shared — move it back down to the feature that owns it.',
      from: { path: '^src/(components|lib)/' },
      to: { path: '^src/app/' },
    },
    {
      name: 'no-sibling-component-internals',
      severity: 'error',
      comment:
        'A shared component folder publishes its surface through index.ts. Reaching past it ' +
        'into another folder\'s internals (helpers, styles, subcomponents) welds the two ' +
        'together — import the barrel, or promote the shared piece out of both.',
      from: { path: '^src/components/([^/]+)/' },
      to: {
        path: '^src/components/([^/]+)/',
        pathNot: ['^src/components/$1/', '^src/components/[^/]+/index\\.ts$'],
      },
    },

    // ---- Layer leaves --------------------------------------------------------
    {
      name: 'contracts-are-a-leaf',
      severity: 'error',
      comment:
        'src/vendor/shared is a trimmed copy of the server contracts. It describes the wire ' +
        'format and must not reach back into app code — a contract that imports a component ' +
        'cannot be mirrored from the server copy any more.',
      from: { path: '^src/vendor/shared/' },
      to: { path: '^src/(app|components|lib)/' },
    },
    {
      name: 'ui-kit-is-a-leaf',
      severity: 'error',
      comment:
        'src/vendor/ui is vendored: fix upstream and re-vendor. A primitive that imports app ' +
        'code cannot survive the next re-vendor, and silently reverses the dependency arrow.',
      from: { path: '^src/vendor/ui/' },
      to: { path: '^src/(app|components|lib)/' },
    },

    // ---- Hygiene -------------------------------------------------------------
    {
      name: 'no-orphans',
      severity: 'warn',
      comment:
        'Unreachable module — dead code left behind by a refactor, or a component that was ' +
        'built but never mounted.',
      from: {
        orphan: true,
        pathNot: [
          '\\.d\\.ts$',
          '(^|/)vendor/',
          // Next.js entrypoints are reached by the router, not by an import.
          '^src/app/.+/(page|layout|template|loading|error|not-found|route)\\.tsx?$',
          '^src/app/(page|layout|global-error)\\.tsx$',
          '^src/(middleware|instrumentation)\\.ts$',
          // Loaded by vitest via setupFiles, not by an import.
          '^src/test/',
          // Config files at the package root are loaded by tooling.
          '^[^/]+\\.(c|m)?(j|t)s$',
        ],
      },
      to: {},
    },
    {
      name: 'not-to-dev-dep',
      severity: 'error',
      comment:
        'Shipped UI code must not import a devDependency — it resolves in dev and fails the ' +
        'production build.',
      from: { path: '^src/', pathNot: ['\\.test\\.tsx?$', '^src/test/', VENDOR] },
      to: { dependencyTypes: ['npm-dev'], dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'no-deprecated-core',
      severity: 'error',
      comment: 'Deprecated Node core module.',
      from: {},
      to: { dependencyTypes: ['core'], path: '^(punycode|domain|sys|util\\.promisify)$' },
    },
  ],

  options: {
    // node_modules is doNotFollow, NOT exclude: excluding it drops npm packages
    // out of the graph entirely, and every rule that names one silently passes.
    // (Learned the hard way on the server config — see root INSIGHTS.md.)
    doNotFollow: { path: '(^|/)node_modules/' },
    exclude: { path: '(^|/)(\\.next|dist|node_modules)/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
      mainFields: ['module', 'main', 'types'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
