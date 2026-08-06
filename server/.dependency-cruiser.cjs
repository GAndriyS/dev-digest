/**
 * Onion-architecture boundaries for @devdigest/api (and the reviewer-core source
 * it aliases in). Machine enforcement for the rules written up in
 * `.claude/skills/onion-architecture/SKILL.md` — prose and CI must agree.
 *
 * Run:  pnpm exec depcruise src ../reviewer-core/src --config .dependency-cruiser.cjs
 *
 * Both trees are cruised from here on purpose: reviewer-core is consumed as
 * TypeScript source through a tsconfig path alias, has no build of its own, and
 * uses npm — installing a second copy of this tool there would buy a second
 * lockfile for one config file.
 *
 * `pathNot` lists marked GRANDFATHERED are debt, not policy. Shrink them; never
 * append. Everything else is a boundary: fix the import direction, not the rule.
 */

/** Modules that predate the routes → service → repository split. */
const LAYERLESS_MODULES = '^src/modules/(polling|pulls|settings|workspace)/';

/**
 * Adapters that export pure functions rather than a stateful client. They are
 * not ports — nothing is injected, nothing is mocked — so a module may import
 * them directly. Every other adapter is resolved through the container.
 */
const PURE_ADAPTERS = '^src/adapters/(git/diff-parser|codeindex/extract|astgrep/)';

module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'A runtime cycle means the layers are not layers. Extract the shared piece downwards ' +
        '(into _shared, platform, or vendor/shared) instead of importing sideways. Type-only ' +
        'cycles are exempt: they erase at compile time, and they are how a service names the ' +
        'Container that constructs it.',
      from: {},
      // viaOnly, not dependencyTypesNot: a cycle is only reported when EVERY edge
      // in it survives at runtime. One `import type` link is enough to break it.
      to: { circular: true, viaOnly: { dependencyTypesNot: ['type-only'] } },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'Unreachable module — dead code, or a missing registration in modules/index.ts.',
      from: { orphan: true, pathNot: ['\\.d\\.ts$', '(^|/)vendor/'] },
      to: {},
    },

    // ---- Edge (routes) ------------------------------------------------------
    {
      name: 'routes-through-service',
      severity: 'error',
      comment:
        'routes.ts is the HTTP edge: validate with zod, call the service, serialize. ' +
        'Persistence belongs behind a repository the service owns.',
      from: { path: '^src/modules/.+/routes\\.ts$', pathNot: LAYERLESS_MODULES },
      to: { path: '^src/db/(schema|client)|(^|/)repository|\\.repo\\.ts$' },
    },

    // ---- Application (services, repositories) -------------------------------
    {
      name: 'service-stays-http-agnostic',
      severity: 'error',
      comment:
        'A service must be callable from a job, a CLI, or a test without a request. ' +
        'Needs the request? Take the resolved values as arguments.',
      from: { path: '^src/modules/.+/(service|repository|helpers)\\.ts$' },
      to: { path: 'node_modules/(fastify|fastify-type-provider-zod|fastify-sse-v2)/' },
    },
    {
      name: 'no-direct-adapter-clients',
      severity: 'error',
      comment:
        'Stateful adapters are ports: depend on the interface from @devdigest/shared and ' +
        'resolve the instance through the container — that is what makes adapters/mocks.ts ' +
        'substitution work. Pure helper adapters are exempt, and so is `import type` of a ' +
        "port interface: naming the abstraction is the point, importing the class isn't.",
      from: { path: '^src/modules/' },
      to: { path: '^src/adapters/', pathNot: PURE_ADAPTERS, dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'no-cross-module-internals',
      severity: 'error',
      comment:
        "Another module's service/repository/helpers are private. Its constants.ts and " +
        'types.ts are its published surface; shared state belongs in the container.',
      from: { path: '^src/modules/([^/]+)/' },
      to: {
        path: '^src/modules/([^/]+)/',
        pathNot: [
          '^src/modules/$1/',
          '^src/modules/_shared/',
          '^src/modules/[^/]+/(constants|types|index)\\.ts$',
        ],
      },
    },

    // ---- Infrastructure -----------------------------------------------------
    {
      name: 'infrastructure-points-inward',
      severity: 'error',
      comment:
        'db/ and adapters/ are the outermost ring: they may not know about modules or the ' +
        'container. Dependencies point inward, and the composition root wires the two.',
      // GRANDFATHERED: the astgrep and depgraph adapters read SUPPORTED_EXT /
      // MAX_SIGNATURE_CHARS out of repo-intel. Those are indexer-domain constants
      // sitting on the wrong side of the boundary — they belong in platform/ or
      // vendor/shared. Move them and delete this exception.
      from: { path: '^src/(db|adapters)/', pathNot: '^src/adapters/(astgrep|depgraph)/' },
      to: { path: '^src/(modules|platform/container)' },
    },
    {
      name: 'db-schema-is-leaf',
      severity: 'error',
      comment: 'The Drizzle schema describes tables. It must not reach back into app code.',
      from: { path: '^src/db/schema' },
      to: { path: '^src/(modules|platform|adapters)/' },
    },

    // ---- reviewer-core: the iron rule ---------------------------------------
    {
      name: 'core-has-no-io',
      severity: 'error',
      comment:
        'reviewer-core is the domain core: no DB, no GitHub, no filesystem, no HTTP server. ' +
        'The only side effect is an injected LLMProvider. Need I/O? It belongs in the caller.',
      from: { path: '^[^/]*/?\\.\\./reviewer-core/src|^\\.\\./reviewer-core/src' },
      to: {
        path: [
          '^(node:)?(fs|fs/promises|path|child_process|os|net|http|https|dns|worker_threads)$',
          'node_modules/(drizzle-orm|postgres|fastify|octokit|@octokit|simple-git|dependency-cruiser|@ast-grep)/',
        ],
      },
    },
    {
      name: 'core-does-not-import-server',
      severity: 'error',
      comment:
        'The core may not reach into the server. The one exception is the canonical contract ' +
        'copy at server/src/vendor/shared, which the core aliases as @devdigest/shared.',
      from: { path: '\\.\\./reviewer-core/src' },
      to: { path: '^src/', pathNot: '^src/vendor/shared' },
    },

    // ---- Hygiene ------------------------------------------------------------
    {
      name: 'not-to-dev-dep',
      severity: 'error',
      comment: 'Production code must not import a devDependency.',
      from: { path: '^src/', pathNot: '\\.(test|spec)\\.ts$' },
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
    doNotFollow: { path: '(^|/)node_modules/' },
    exclude: { path: '(^|/)(dist|clones)/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.js', '.ts', '.mjs', '.cjs'],
      mainFields: ['module', 'main', 'types'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
