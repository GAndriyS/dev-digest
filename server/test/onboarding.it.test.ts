import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { Onboarding } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockLLMProvider, MockSecretsProvider } from '../src/adapters/mocks.js';
import type { RepoIntel, IndexState } from '../src/modules/repo-intel/types.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[onboarding] Docker not available — skipping integration tests.');
}

/**
 * Onboarding tour generator (SPEC-03) over a real Postgres and a real (temp)
 * clone. Covers: the pre-generation empty state and the cache read (AC-3,
 * AC-5) never calling the model; exactly one model call and a full row
 * overwrite on `generate` (AC-4); the fixed five-section contract (AC-9); a
 * `run_locally` section grounded in a file actually read off the clone
 * (AC-15); every skeleton branch and its "never persisted" guarantee
 * (AC-23); the polite `generate`-while-degraded no-op (AC-25); a failed
 * model call leaving the previous stored tour untouched (AC-26); the 409
 * "no provider key" distinguishing code, reached without any network call
 * (AC-27); the onboarding module's own `partial` index read that never masks
 * a degraded/failed pipeline status (AC-28); a cached tour showing the index
 * summary frozen at generation time, not the live one (AC-29); the wire
 * contract shape (AC-30); route-level `:id` validation (AC-32); and the
 * exactly-one-line server log for both a successful generation and a
 * skeleton (AC-33, AC-35), plus locale threading into the model messages
 * (AC-36).
 *
 * `repoIntel` is a hand-written fake (not `container.repoIntel`'s real
 * Postgres-backed implementation) — repo-intel's own ranking/graph behaviour
 * is out of scope here (repo-intel's own test suite), and a fake lets AC-28's
 * `full`-vs-`degraded` and AC-29's "state changed since generation" cases be
 * expressed as plain data instead of a second indexing pass.
 */
d('onboarding module', () => {
  let pg: PgFixture;
  let clonePath: string;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));

    clonePath = await mkdtemp(join(tmpdir(), 'devdigest-onboarding-'));
    for (const [rel, body] of [
      [
        'package.json',
        JSON.stringify({ name: 'demo', scripts: { dev: 'next dev', build: 'next build' } }),
      ],
      ['src/index.ts', 'export const start = () => {};\n'],
      ['src/utils.ts', 'export const helper = () => {};\n'],
    ] as const) {
      await mkdir(dirname(join(clonePath, rel)), { recursive: true });
      await writeFile(join(clonePath, rel), body, 'utf8');
    }

    // Same rationale as `conventions.it.test.ts`/`context.it.test.ts`: this
    // hook does everything `startPg` does (slow on a cold Docker) plus
    // seeding and laying down a temp clone.
  }, 300_000);

  afterAll(async () => {
    await pg?.stop();
    if (clonePath) await rm(clonePath, { recursive: true, force: true });
  });

  let seq = 0;
  /** A fresh repo per test — `generate` fully overwrites the one `onboarding` row per repo (AC-4/AC-5), so sharing a repo across cases would make them depend on each other. */
  async function freshRepo(opts: { clonePath?: string | null } = {}): Promise<string> {
    const name = `onboarding-fixture-${seq++}`;
    const cp = opts.clonePath === undefined ? clonePath : opts.clonePath;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}`, clonePath: cp })
      .returning();
    return repo!.id;
  }

  function defaultIndexState(over: Partial<IndexState> = {}): IndexState {
    return {
      status: 'full',
      filesIndexed: 2,
      filesSkipped: 0,
      durationMs: 5,
      repoId: 'unused',
      lastIndexedSha: 'deadbeef',
      indexerVersion: 1,
      updatedAt: new Date('2026-08-01T00:00:00Z'),
      totalCandidates: 2,
      bounded: 0,
      ...over,
    };
  }

  /**
   * `repoIntel` is a stateful fake — `setState` lets AC-29 mutate the "live"
   * index mid-test, without a second real indexing pass, to prove a cached
   * tour keeps showing the index summary from when it was generated.
   *
   * Only the three methods the onboarding module actually calls
   * (`getIndexState`, `getTopFilesByRank`, `getCriticalPaths`) are
   * implemented — same pattern as `conventions.it.test.ts`'s
   * `repoIntel` stub — so a wiring mistake that reaches for anything else
   * fails loudly instead of silently returning the wrong shape.
   */
  function makeRepoIntel(
    initial: Partial<IndexState> = {},
    facts: { topFiles?: string[]; criticalPaths?: string[][] } = {},
  ): RepoIntel & { setState: (next: Partial<IndexState>) => void } {
    let state: IndexState = defaultIndexState(initial);
    return {
      async getIndexState() {
        return state;
      },
      async getTopFilesByRank() {
        return facts.topFiles ?? ['src/index.ts', 'src/utils.ts'];
      },
      async getCriticalPaths() {
        return facts.criticalPaths ?? [];
      },
      setState(next: Partial<IndexState>) {
        state = { ...state, ...next };
      },
    } as unknown as RepoIntel & { setState: (next: Partial<IndexState>) => void };
  }

  /**
   * A schema-valid `OnboardingDraft` fixture grounded entirely in facts the
   * fixture clone/repoIntel actually produce (`src/index.ts`, `src/utils.ts`,
   * `package.json`) — every link here survives post-validation, so
   * `droppedPaths` is 0 unless a test deliberately adds an invented path.
   */
  function draftFixture(over: Partial<Record<string, unknown>> = {}) {
    return {
      architecture_overview: {
        title: 'Architecture overview',
        body: 'This service starts at **src/index.ts** and fans out from there.',
        diagram: null,
        links: [{ label: 'Entry point', path: 'src/index.ts' }],
      },
      critical_paths: {
        title: 'Critical paths',
        body: 'The entry point is the most-imported file in this repo.',
        links: [{ label: 'Entry point', path: 'src/index.ts' }],
      },
      run_locally: {
        title: 'Run locally',
        body: '1. `npm install`\n2. `npm run dev`',
        // `label` is the command, `path` the config file it was read from
        // (see `LinkDraft`'s doc comment in helpers.ts) — the fixture must
        // grade the same as `package.json`'s actual `scripts`.
        links: [
          { label: 'npm install', path: 'package.json' },
          { label: 'npm run dev', path: 'package.json' },
        ],
      },
      reading_path: {
        title: 'Reading path',
        body: 'Start with the entry point, then the shared utilities.',
        entries: [
          { path: 'src/utils.ts', rationale: 'Shared helpers used everywhere.' },
          { path: 'src/index.ts', rationale: 'Where requests come in.' },
        ],
      },
      first_tasks: {
        title: 'First tasks',
        body: 'Nothing is covered by tests yet.',
        tasks: [{ path: 'src/index.ts', description: 'Add a smoke test for the entry point.' }],
      },
      ...over,
    };
  }

  /**
   * `makeApp` mirrors `conventions.it.test.ts`'s: a fresh `Container` per app
   * so each test's mocks/config are isolated. Omitting `llm` entirely (AC-27)
   * leaves `container.llm('openrouter')` to fall through to
   * `secrets.get('OPENROUTER_API_KEY')` — no `llm.openrouter` override means
   * no network client is ever constructed, only `MockSecretsProvider`'s
   * in-memory lookup (A4).
   */
  async function makeApp(opts: {
    repoIntel: RepoIntel;
    llm?: MockLLMProvider;
    secrets?: MockSecretsProvider;
    repoIntelEnabled?: boolean;
  }) {
    const envOverrides: Record<string, string> = {};
    if (opts.repoIntelEnabled === false) envOverrides.REPO_INTEL_ENABLED = 'false';
    const config = loadConfig({
      ...process.env,
      NODE_ENV: 'test',
      ...envOverrides,
    } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        repoIntel: opts.repoIntel,
        ...(opts.secrets ? { secrets: opts.secrets } : {}),
        ...(opts.llm ? { llm: { openrouter: opts.llm } } : {}),
      },
    });
  }

  // ---------------------------------------------------------------------
  // AC-3 — empty pre-generation state, zero model calls.
  // ---------------------------------------------------------------------
  it('shows the empty state before any tour has been generated, with no model call', async () => {
    const llm = new MockLLMProvider('openai', { structured: draftFixture() });
    const app = await makeApp({ repoIntel: makeRepoIntel(), llm });
    const repoId = await freshRepo();

    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/onboarding` });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.status).toBe('ready');
    expect(body.generated_at).toBeNull();
    expect(body.sections).toEqual([]);
    expect(llm.calls).toHaveLength(0);
  });

  // ---------------------------------------------------------------------
  // AC-4, AC-9, AC-15, AC-33, AC-36 — generate: one call, full row write,
  // fixed section order, run_locally grounded in a real clone read, the log
  // line, locale in the messages sent to the model.
  // ---------------------------------------------------------------------
  describe('generate', () => {
    it('makes exactly one model call and writes a full row with generated_at (AC-4)', async () => {
      const llm = new MockLLMProvider('openai', { structured: draftFixture() });
      const app = await makeApp({ repoIntel: makeRepoIntel(), llm });
      const repoId = await freshRepo();

      const res = await app.inject({
        method: 'POST',
        url: `/repos/${repoId}/onboarding/generate`,
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);
      expect(body.status).toBe('ready');
      expect(body.generated_at).not.toBeNull();

      const [row] = await pg.handle.db
        .select()
        .from(t.onboarding)
        .where(eq(t.onboarding.repoId, repoId));
      expect(row).toBeDefined();
      expect(row!.generatedAt.toISOString()).toBe(body.generated_at);
    });

    // ---------------------------------------------------------------------
    // fix-pass finding #5 — the body is optional at the route: every field
    // of `OnboardingGenerateBody` is already `.optional()`, but that alone
    // only covers a SENT empty object, not a truly body-less POST
    // (`req.body === undefined`, no `content-type` sent).
    // ---------------------------------------------------------------------
    it('accepts a body-less POST and still generates (falls back to the en default locale)', async () => {
      const llm = new MockLLMProvider('openai', { structured: draftFixture() });
      const app = await makeApp({ repoIntel: makeRepoIntel(), llm });
      const repoId = await freshRepo();

      // No `payload` key at all — `light-my-request` sends no body and no
      // `content-type`, unlike `payload: {}` (used by every other test here),
      // which serializes to a real JSON body.
      const res = await app.inject({
        method: 'POST',
        url: `/repos/${repoId}/onboarding/generate`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('ready');
    });

    it('returns exactly five sections, in the fixed kind order (AC-9)', async () => {
      const llm = new MockLLMProvider('openai', { structured: draftFixture() });
      const app = await makeApp({ repoIntel: makeRepoIntel(), llm });
      const repoId = await freshRepo();

      const res = await app.inject({
        method: 'POST',
        url: `/repos/${repoId}/onboarding/generate`,
        payload: {},
      });
      const body = res.json();

      expect(body.sections.map((s: { kind: string }) => s.kind)).toEqual([
        'architecture_overview',
        'critical_paths',
        'run_locally',
        'reading_path',
        'first_tasks',
      ]);
    });

    it('grounds run_locally in a config file actually read off the clone (AC-15)', async () => {
      const llm = new MockLLMProvider('openai', { structured: draftFixture() });
      const app = await makeApp({ repoIntel: makeRepoIntel(), llm });
      const repoId = await freshRepo();

      const res = await app.inject({
        method: 'POST',
        url: `/repos/${repoId}/onboarding/generate`,
        payload: {},
      });
      const runLocally = res
        .json()
        .sections.find((s: { kind: string }) => s.kind === 'run_locally');

      expect(runLocally.body).toContain('npm install');
      // The command's `path` came from a genuinely-read root `package.json`,
      // not an invented path — post-validation would have dropped it
      // otherwise. `label` is the copyable command itself.
      expect(runLocally.links).toContainEqual({ label: 'npm install', path: 'package.json' });
    });

    it('drops a link whose path was never in the collected facts (AC-21 grounding, exercised alongside AC-9)', async () => {
      const llm = new MockLLMProvider('openai', {
        structured: draftFixture({
          architecture_overview: {
            title: 'Architecture overview',
            body: 'Body.',
            diagram: null,
            links: [
              { label: 'Entry point', path: 'src/index.ts' },
              { label: 'Invented', path: 'src/api/public/index.ts' },
            ],
          },
        }),
      });
      const app = await makeApp({ repoIntel: makeRepoIntel(), llm });
      const repoId = await freshRepo();

      const res = await app.inject({
        method: 'POST',
        url: `/repos/${repoId}/onboarding/generate`,
        payload: {},
      });
      const architecture = res
        .json()
        .sections.find((s: { kind: string }) => s.kind === 'architecture_overview');

      expect(architecture.links).toEqual([{ label: 'Entry point', path: 'src/index.ts' }]);
    });

    it('writes exactly one server log line with the provider/model/calls/tokens/cost/repoId/duration (AC-33)', async () => {
      const llm = new MockLLMProvider('openai', { structured: draftFixture() });
      const app = await makeApp({ repoIntel: makeRepoIntel(), llm });
      const repoId = await freshRepo();
      const infoSpy = vi.spyOn(app.log, 'info');

      await app.inject({
        method: 'POST',
        url: `/repos/${repoId}/onboarding/generate`,
        payload: {},
      });

      // Fastify shares `app.log` with the per-request `req.log` when the
      // built-in logger is `false` (`abstract-logging`'s `child()` returns
      // `this`, `server/src/app.ts:50-52`) — the spy also catches Fastify's
      // own "incoming request" line, so filter to OUR message rather than
      // asserting the raw call count on the shared logger.
      const ourCalls = infoSpy.mock.calls.filter(([, msg]) => msg === 'onboarding tour generated');
      expect(ourCalls).toHaveLength(1);
      const [fields] = ourCalls[0]!;
      expect(fields).toMatchObject({
        provider: 'openrouter',
        model: 'deepseek/deepseek-v4-flash',
        calls: 1,
        tokensIn: 100,
        tokensOut: 50,
        costUsd: 0.001,
        droppedPaths: 0,
        repoId,
      });
      expect(typeof (fields as { durationMs: number }).durationMs).toBe('number');
    });

    it('threads the requested locale into the messages sent to the model, defaulting to en (AC-36)', async () => {
      const llm = new MockLLMProvider('openai', { structured: draftFixture() });
      const app = await makeApp({ repoIntel: makeRepoIntel(), llm });

      const repoUk = await freshRepo();
      await app.inject({
        method: 'POST',
        url: `/repos/${repoUk}/onboarding/generate`,
        payload: { locale: 'uk' },
      });
      const ukReq = llm.calls.find((c) => c.method === 'completeStructured')!.req as {
        messages: { role: string; content: string }[];
      };
      const ukUserMessage = ukReq.messages.find((m) => m.role === 'user')!;
      expect(ukUserMessage.content).toContain('in "uk".');

      const repoDefault = await freshRepo();
      await app.inject({
        method: 'POST',
        url: `/repos/${repoDefault}/onboarding/generate`,
        payload: {},
      });
      const calls = llm.calls.filter((c) => c.method === 'completeStructured');
      const defaultReq = calls[calls.length - 1]!.req as {
        messages: { role: string; content: string }[];
      };
      const defaultUserMessage = defaultReq.messages.find((m) => m.role === 'user')!;
      expect(defaultUserMessage.content).toContain('in "en".');
    });
  });

  // ---------------------------------------------------------------------
  // AC-5 — cache read, zero model calls.
  // ---------------------------------------------------------------------
  it('serves a previously generated tour from cache without calling the model again (AC-5)', async () => {
    const llm = new MockLLMProvider('openai', { structured: draftFixture() });
    const app = await makeApp({ repoIntel: makeRepoIntel(), llm });
    const repoId = await freshRepo();

    const generated = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/onboarding/generate`,
      payload: {},
    });
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);

    const cached = await app.inject({ method: 'GET', url: `/repos/${repoId}/onboarding` });
    expect(cached.statusCode).toBe(200);
    expect(cached.json()).toEqual(generated.json());
    // The GET made NO additional model call.
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);
  });

  // ---------------------------------------------------------------------
  // AC-23, AC-25, AC-35 — every skeleton branch: no model call, not
  // persisted, and a single log line naming the reason.
  // ---------------------------------------------------------------------
  describe('skeleton branches (AC-23)', () => {
    const cases: {
      name: string;
      reason: string;
      repoIntelEnabled?: boolean;
      clonePath?: string | null;
      state?: Partial<IndexState>;
    }[] = [
      { name: 'no clone on disk', reason: 'no_clone', clonePath: null },
      { name: 'repo-intel disabled', reason: 'disabled', repoIntelEnabled: false },
      {
        name: 'never indexed',
        reason: 'not_indexed',
        state: { status: 'degraded', degradedReason: 'no_data', filesIndexed: 0, totalCandidates: 0 },
      },
      { name: 'index degraded', reason: 'degraded', state: { status: 'degraded' } },
      { name: 'index failed', reason: 'failed', state: { status: 'failed' } },
    ];

    for (const c of cases) {
      it(`${c.name} → skeleton reason "${c.reason}", zero model calls, not stored`, async () => {
        const llm = new MockLLMProvider('openai', { structured: draftFixture() });
        const app = await makeApp({
          repoIntel: makeRepoIntel(c.state ?? {}),
          llm,
          repoIntelEnabled: c.repoIntelEnabled,
        });
        const repoId = await freshRepo({ clonePath: c.clonePath });

        const res = await app.inject({
          method: 'POST',
          url: `/repos/${repoId}/onboarding/generate`,
          payload: {},
        });
        expect(res.statusCode).toBe(200);
        const body = res.json();

        expect(body.status).toBe('skeleton');
        expect(body.reason).toBe(c.reason);
        expect(body.generated_at).toBeNull();
        expect(body.sections).toHaveLength(5);
        expect(llm.calls.filter((call) => call.method === 'completeStructured')).toHaveLength(0);

        const [row] = await pg.handle.db
          .select()
          .from(t.onboarding)
          .where(eq(t.onboarding.repoId, repoId));
        expect(row).toBeUndefined();
      });
    }

    it('GET (not just generate) also serves the skeleton for a repo with no clone', async () => {
      const app = await makeApp({ repoIntel: makeRepoIntel() });
      const repoId = await freshRepo({ clonePath: null });

      const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/onboarding` });
      expect(res.json()).toMatchObject({ status: 'skeleton', reason: 'no_clone' });
    });

    it('writes a log line naming the skeleton reason with calls=0 (AC-35)', async () => {
      const app = await makeApp({ repoIntel: makeRepoIntel({ status: 'failed' }) });
      const repoId = await freshRepo();
      const infoSpy = vi.spyOn(app.log, 'info');

      await app.inject({
        method: 'POST',
        url: `/repos/${repoId}/onboarding/generate`,
        payload: {},
      });

      // Same shared-logger caveat as the AC-33 test above — filter to OUR line.
      const ourCalls = infoSpy.mock.calls.filter(([, msg]) => msg === 'onboarding tour generated');
      expect(ourCalls).toHaveLength(1);
      const [fields] = ourCalls[0]!;
      expect(fields).toMatchObject({ calls: 0, reason: 'failed', repoId });
    });
  });

  // ---------------------------------------------------------------------
  // AC-25 — Generate is a polite no-op (200, same skeleton) while degraded,
  // never an error.
  // ---------------------------------------------------------------------
  it('answers 200 with the same skeleton, not an error, when Generate is pressed while degraded (AC-25)', async () => {
    const llm = new MockLLMProvider('openai', { structured: draftFixture() });
    const app = await makeApp({ repoIntel: makeRepoIntel({ status: 'degraded' }), llm });
    const repoId = await freshRepo();

    const first = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/onboarding/generate`,
      payload: {},
    });
    const second = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/onboarding/generate`,
      payload: {},
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ status: 'skeleton', reason: 'degraded' });
    expect(second.json()).toMatchObject({ status: 'skeleton', reason: 'degraded' });
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(0);
  });

  // ---------------------------------------------------------------------
  // AC-26 — a failed model call leaves the previous stored tour untouched.
  // ---------------------------------------------------------------------
  it('skeletons with llm_failed on a bad model response and leaves the previously stored tour untouched (AC-26)', async () => {
    const repoIntel = makeRepoIntel();
    const goodLlm = new MockLLMProvider('openai', { structured: draftFixture() });
    const app1 = await makeApp({ repoIntel, llm: goodLlm });
    const repoId = await freshRepo();

    const firstGenerate = await app1.inject({
      method: 'POST',
      url: `/repos/${repoId}/onboarding/generate`,
      payload: {},
    });
    expect(firstGenerate.json().status).toBe('ready');
    const storedGeneratedAt = firstGenerate.json().generated_at;

    // A fixture that fails `OnboardingDraft`'s schema — the mock throws
    // exactly as `completeStructured` would after exhausting retries on
    // invalid JSON (`openai.ts:132-134`).
    const badLlm = new MockLLMProvider('openai', { structured: { not: 'a valid draft' } });
    const app2 = await makeApp({ repoIntel, llm: badLlm });
    const infoSpy = vi.spyOn(app2.log, 'info');

    const secondGenerate = await app2.inject({
      method: 'POST',
      url: `/repos/${repoId}/onboarding/generate`,
      payload: {},
    });
    expect(secondGenerate.statusCode).toBe(200);
    expect(secondGenerate.json()).toMatchObject({ status: 'skeleton', reason: 'llm_failed' });

    // The log line names WHY, not just that it failed (fix-pass finding #4) —
    // `attempts` is honestly `null` here: the mock throws before
    // `completeStructured` can report how many attempts it made.
    const ourCalls = infoSpy.mock.calls.filter(([, msg]) => msg === 'onboarding tour generated');
    expect(ourCalls).toHaveLength(1);
    const [fields] = ourCalls[0]!;
    expect(fields).toMatchObject({ reason: 'llm_failed', attempts: null });
    expect(typeof (fields as { error?: unknown }).error).toBe('string');
    expect((fields as { error: string }).error).toContain('MockLLMProvider fixture failed schema');

    const after = await app1.inject({ method: 'GET', url: `/repos/${repoId}/onboarding` });
    expect(after.json().status).toBe('ready');
    expect(after.json().generated_at).toBe(storedGeneratedAt);
    expect(after.json().sections).toEqual(firstGenerate.json().sections);
  });

  // ---------------------------------------------------------------------
  // AC-27 — 409 distinguishing "no key" from a server fault, no network call.
  // ---------------------------------------------------------------------
  it('answers 409 with a distinct code when no provider key is configured, without reaching the network (AC-27)', async () => {
    // A4: no `llm.openrouter` override at all — `container.llm('openrouter')`
    // must fall through to `MockSecretsProvider({})`'s empty lookup and throw
    // `ConfigError` before any HTTP client is ever constructed.
    const app = await makeApp({
      repoIntel: makeRepoIntel(),
      secrets: new MockSecretsProvider({}),
    });
    const repoId = await freshRepo();

    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/onboarding/generate`,
      payload: {},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('no_provider_key');
  });

  // ---------------------------------------------------------------------
  // AC-28 — the onboarding module's OWN `partial` read; never masks a
  // degraded/failed pipeline status underneath (A5).
  // ---------------------------------------------------------------------
  describe('index summary status (AC-28)', () => {
    it('reports partial when a clean pass was bounded by MAX_INDEXED_FILES', async () => {
      const app = await makeApp({
        repoIntel: makeRepoIntel({ status: 'full', bounded: 42, filesIndexed: 5000, totalCandidates: 5042 }),
      });
      const repoId = await freshRepo();

      const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/onboarding` });
      expect(res.json().index).toMatchObject({
        status: 'partial',
        bounded: true,
        files_indexed: 5000,
        total_candidates: 5042,
      });
    });

    it('does NOT mask a degraded status as partial, even when bounded (A5)', async () => {
      const app = await makeApp({
        repoIntel: makeRepoIntel({ status: 'degraded', bounded: 42 }),
      });
      const repoId = await freshRepo();

      const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/onboarding` });
      expect(res.json()).toMatchObject({ status: 'skeleton', reason: 'degraded' });
      expect(res.json().index.status).toBe('degraded');
    });

    it('reports full, not partial, when nothing was bounded', async () => {
      const app = await makeApp({
        repoIntel: makeRepoIntel({ status: 'full', bounded: 0 }),
      });
      const repoId = await freshRepo();

      const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/onboarding` });
      expect(res.json().index).toMatchObject({ status: 'full', bounded: false });
    });
  });

  // ---------------------------------------------------------------------
  // AC-29 — a cached tour shows the index summary frozen at generation time.
  // ---------------------------------------------------------------------
  it('keeps showing the index summary from generation time after the repo is reindexed (AC-29)', async () => {
    const repoIntel = makeRepoIntel({ status: 'full', filesIndexed: 100, totalCandidates: 120, bounded: 0 });
    const llm = new MockLLMProvider('openai', { structured: draftFixture() });
    const app = await makeApp({ repoIntel, llm });
    const repoId = await freshRepo();

    const generated = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/onboarding/generate`,
      payload: {},
    });
    expect(generated.json().index).toMatchObject({
      files_indexed: 100,
      total_candidates: 120,
      bounded: false,
      status: 'full',
    });

    // The repo is reindexed — the SAME fake, mutated in place, exactly as a
    // second real indexing pass would change what `getIndexState` returns.
    repoIntel.setState({ filesIndexed: 5000, totalCandidates: 5042, bounded: 42, status: 'full' });

    const cached = await app.inject({ method: 'GET', url: `/repos/${repoId}/onboarding` });
    expect(cached.json().generated_at).toBe(generated.json().generated_at);
    // Still the numbers from generation time, NOT the live (now-partial) index.
    expect(cached.json().index).toEqual(generated.json().index);
  });

  // ---------------------------------------------------------------------
  // AC-30 — wire contract shape.
  // ---------------------------------------------------------------------
  it('carries the tour on the wire as the Onboarding contract (AC-30)', async () => {
    const llm = new MockLLMProvider('openai', { structured: draftFixture() });
    const app = await makeApp({ repoIntel: makeRepoIntel(), llm });
    const repoId = await freshRepo();

    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/onboarding/generate`,
      payload: {},
    });

    const parsed = Onboarding.safeParse(res.json());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.reason).toBeNull();
      expect(Object.keys(parsed.data.index).sort()).toEqual(
        ['bounded', 'files_indexed', 'status', 'total_candidates'].sort(),
      );
    }
  });

  // ---------------------------------------------------------------------
  // AC-32 — repo-scoped routes, `:id` validated at the edge.
  // ---------------------------------------------------------------------
  describe('route param validation (AC-32)', () => {
    it('422s a non-uuid :id on both GET and POST', async () => {
      const app = await makeApp({ repoIntel: makeRepoIntel() });

      const get = await app.inject({ method: 'GET', url: '/repos/not-a-uuid/onboarding' });
      expect(get.statusCode).toBe(422);

      const post = await app.inject({
        method: 'POST',
        url: '/repos/not-a-uuid/onboarding/generate',
        payload: {},
      });
      expect(post.statusCode).toBe(422);
    });

    it('200s a valid uuid :id for an existing repo', async () => {
      const app = await makeApp({ repoIntel: makeRepoIntel() });
      const repoId = await freshRepo();

      const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/onboarding` });
      expect(res.statusCode).toBe(200);
    });
  });
});
