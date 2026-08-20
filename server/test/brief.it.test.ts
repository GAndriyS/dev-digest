import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockBlast } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { ProjectContext } from '../src/modules/context/types.js';
import type { ContextListing, ContextPaths, SpecFile } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[brief] Docker not available — skipping integration tests.');
}

/**
 * PR Why + Risk Brief (L05/SPEC-04) over a real Postgres. Covers: the
 * pre-generation `null` state (AC-1, AC-2) and an unknown PR 404ing (AC-3);
 * exactly one model call on POST and a persisted row (AC-4, AC-23); the
 * cache read spending zero model calls (AC-1, AC-25); `stale` flipping on a
 * `head_sha` move without auto-regeneration (AC-26); a failed generation
 * leaving the previously stored brief AND the `reviews` table untouched
 * (AC-16, AC-28, AC-50); the per-route 429 (AC-5); a PR with zero `pr_files`
 * rows producing `inputs[].diff === 'unavailable'` rather than a silent
 * empty result (`server/INSIGHTS.md:106-114`); and the single generation log
 * line carrying `inputs[]` in FULL on BOTH outcomes — success and a failed
 * generation alike (amendment A4, closed for the failure path too).
 *
 * `container.blast` is overridden with `MockBlast` (structurally compatible,
 * never `implements Blast` — `adapters/**` cannot import `modules/**`,
 * `infrastructure-points-inward`); `container.reviewRepo`/`projectContext`
 * are the REAL, Postgres-backed implementations (no override exists for
 * `reviewRepo` on the container at all) — a fresh repo's `clone_path` stays
 * `null`, so `projectContext.listContext` throws "not cloned" and facts.ts's
 * own `catch` produces zero `context_doc` entries, exercising AC-13 for
 * free. `container.llm` is mocked under the OVERRIDE slot key `openai`
 * (`risk_brief`'s default provider, `vendor/shared/contracts/platform.ts:67-72`),
 * never by the mock's own `.id` — the exact trap `server/INSIGHTS.md:266-286`
 * documents: an unmocked slot reaches a REAL `openai` SDK call and the test
 * hangs ~10s.
 */
d('PR Why + Risk Brief (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));
  }, 300_000);

  afterAll(async () => {
    await pg?.stop();
  });

  let repoSeq = 0;
  /** A fresh repo + PR per test — `clone_path` stays `null` (AC-13's no-clone path) unless a test needs otherwise. */
  async function setupRepoAndPr(opts: { body?: string; headSha?: string } = {}) {
    const name = `brief-fixture-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 900 + repoSeq,
        title: 'Add rate limiting to public API endpoints',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: opts.headSha ?? 'a1b2c3d4e5f6',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
        body: opts.body ?? 'Adds rate limiting to public endpoints.',
      })
      .returning();
    return { repo: repo!, pr: pr! };
  }

  async function insertPrFile(prId: string, over: Partial<{ path: string; patch: string | null }> = {}) {
    await pg.handle.db.insert(t.prFiles).values({
      prId,
      path: over.path ?? 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch:
        over.patch === undefined
          ? '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,'
          : over.patch,
    });
  }

  /** A schema-valid `BriefDraft` fixture grounded in `src/config.ts` — the one file `insertPrFile` seeds by default. */
  function draftFixture(over: Partial<Record<string, unknown>> = {}) {
    return {
      what: 'Adds a stripeKey field wired through the public API config.',
      why: 'Needed to key rate limiting off the caller’s API credential.',
      risk_level: 'high',
      risks: [
        {
          kind: 'security',
          title: 'Secret material in config',
          explanation: 'A key literal lands directly in src/config.ts.',
          severity: 'high',
          file_refs: ['src/config.ts'],
        },
      ],
      review_focus: [
        { path: 'src/config.ts', reason: 'New secret-shaped field added here.', line: null },
      ],
      ...over,
    };
  }

  /**
   * A `ProjectContext` fake for item 3's regression test — structurally
   * compatible, never `implements` the real `ContextService` (mirrors the
   * `MockBlast` precedent above): `listContext` returns `count` documents all
   * sharing the `src/` leading segment with `insertPrFile`'s default
   * `src/config.ts`, so `relevantContextDocs` matches every one of them —
   * proving the bound on `inputs[]`'s `context_doc` entries applies even when
   * the real relevance filter would let hundreds through.
   */
  class ManyDocsProjectContext implements ProjectContext {
    constructor(private readonly count: number) {}
    async listContext(): Promise<ContextListing> {
      return {
        files: Array.from({ length: this.count }, (_, i) => ({
          path: `src/doc-${i}.md`,
          content: null,
        })),
      };
    }
    async readDoc(_workspaceId: string, _repoId: string, path: string): Promise<SpecFile> {
      return { path, content: `content of ${path}` };
    }
    async agentDocs(): Promise<ContextPaths | undefined> {
      return undefined;
    }
    async setAgentDocs(): Promise<ContextPaths | undefined> {
      return undefined;
    }
    async skillDocs(): Promise<ContextPaths | undefined> {
      return undefined;
    }
    async setSkillDocs(): Promise<ContextPaths | undefined> {
      return undefined;
    }
    async resolveForRun() {
      return { specs: [], attached: [], specsRead: [], skipped: [] };
    }
  }

  /**
   * `NODE_ENV: 'test'` (the default here) disables the GLOBAL rate-limit
   * plugin registration entirely (`app.ts:106-110`) — without it,
   * `@fastify/rate-limit`'s `onRoute` hook never runs, so a route's own
   * `config: { rateLimit: {...} }` is inert data nobody reads and NO request
   * can ever 429. Proving AC-5's PER-route limit therefore requires building
   * a SEPARATE app with the plugin actually registered (`nodeEnv:
   * 'development'`, silenced logging) — see the dedicated 429 test below.
   */
  function makeApp(
    opts: {
      llm?: MockLLMProvider;
      nodeEnv?: 'test' | 'development';
      projectContext?: ProjectContext;
    } = {},
  ) {
    const config = loadConfig({
      ...process.env,
      NODE_ENV: opts.nodeEnv ?? 'test',
      LOG_LEVEL: 'silent',
    } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        blast: new MockBlast(),
        ...(opts.projectContext ? { projectContext: opts.projectContext } : {}),
        ...(opts.llm ? { llm: { openai: opts.llm } } : {}),
      },
    });
  }

  // ---------------------------------------------------------------------
  // AC-1, AC-2 — pre-generation empty state.
  // ---------------------------------------------------------------------
  it('GET before any generation returns null with 200, not 404 (AC-1, AC-2)', async () => {
    const app = await makeApp();
    const { pr } = await setupRepoAndPr();

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();

    await app.close();
  });

  // ---------------------------------------------------------------------
  // AC-3 — tenancy gate: unknown PR id 404s on both routes.
  // ---------------------------------------------------------------------
  it('404s both GET and POST for a PR id that does not exist (AC-3)', async () => {
    const app = await makeApp();
    const unknownId = randomUUID();

    const got = await app.inject({ method: 'GET', url: `/pulls/${unknownId}/brief` });
    expect(got.statusCode).toBe(404);

    const posted = await app.inject({ method: 'POST', url: `/pulls/${unknownId}/brief` });
    expect(posted.statusCode).toBe(404);

    await app.close();
  });

  // ---------------------------------------------------------------------
  // AC-4, AC-23, AC-25 — POST makes exactly one model call and persists;
  // a subsequent GET serves the cache with ZERO additional model calls.
  // ---------------------------------------------------------------------
  it('POST generates with exactly one model call and persists; GET afterwards caches it with no further model call (AC-4, AC-23, AC-25)', async () => {
    const llm = new MockLLMProvider('openai', { structured: draftFixture() });
    const app = await makeApp({ llm });
    const { pr } = await setupRepoAndPr();
    await insertPrFile(pr.id);

    const posted = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(posted.statusCode).toBe(200);
    const generated = posted.json();

    expect(generated.what).toContain('stripeKey');
    expect(generated.risk_level).toBe('high');
    expect(generated.risks).toHaveLength(1);
    expect(generated.review_focus).toEqual([
      { path: 'src/config.ts', reason: 'New secret-shaped field added here.', line: null },
    ]);
    expect(generated.head_sha).toBe(pr.headSha);
    expect(generated.model).toBe('gpt-4.1');
    expect(generated.stale).toBe(false);
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);

    const [row] = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id));
    expect(row).toBeDefined();
    expect(row!.headSha).toBe(pr.headSha);
    expect(row!.model).toBe('gpt-4.1');

    const cached = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(cached.statusCode).toBe(200);
    expect(cached.json()).toEqual(generated);
    // The GET made NO additional model call.
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);

    await app.close();
  });

  // ---------------------------------------------------------------------
  // AC-26 — stale flips when head_sha moves, without auto-regeneration.
  // ---------------------------------------------------------------------
  it('flips stale to true when the PR head_sha moves, without regenerating automatically (AC-26)', async () => {
    const llm = new MockLLMProvider('openai', { structured: draftFixture() });
    const app = await makeApp({ llm });
    const { pr } = await setupRepoAndPr();
    await insertPrFile(pr.id);

    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);

    await pg.handle.db
      .update(t.pullRequests)
      .set({ headSha: 'new-head-sha-after-a-push' })
      .where(eq(t.pullRequests.id, pr.id));

    const afterPush = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(afterPush.statusCode).toBe(200);
    expect(afterPush.json().stale).toBe(true);
    // Still the OLD content — GET never regenerates.
    expect(afterPush.json().head_sha).toBe(pr.headSha);
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);

    await app.close();
  });

  // ---------------------------------------------------------------------
  // AC-16, AC-28, AC-50 — a failed generation leaves the previously stored
  // brief AND the reviews table untouched.
  // ---------------------------------------------------------------------
  it('leaves the previously stored brief AND the reviews table untouched when generation fails (AC-16, AC-28, AC-50)', async () => {
    const goodLlm = new MockLLMProvider('openai', { structured: draftFixture() });
    const app1 = await makeApp({ llm: goodLlm });
    const { pr } = await setupRepoAndPr();
    await insertPrFile(pr.id);

    // A pre-existing agent review — AC-49/AC-50: brief generation must not
    // touch `reviews`, whether it succeeds or fails.
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({ workspaceId, prId: pr.id, kind: 'review', score: 61 })
      .returning();

    const firstGenerate = await app1.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(firstGenerate.statusCode).toBe(200);
    const stored = firstGenerate.json();

    // A fixture that fails `BriefDraft`'s schema — the mock throws exactly as
    // `completeStructured` would after exhausting retries on invalid JSON.
    const badLlm = new MockLLMProvider('openai', { structured: { not: 'a valid draft' } });
    const app2 = await makeApp({ llm: badLlm });
    const infoSpy = vi.spyOn(app2.log, 'info');

    const secondGenerate = await app2.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(secondGenerate.statusCode).toBe(502);
    expect(secondGenerate.json().error.code).toBe('external_service_error');
    // The 502 body is unchanged by A4 — telemetry travels on the thrown
    // error's own `.telemetry` property, never into `details`.
    expect(secondGenerate.json().error.details).not.toHaveProperty('inputs');

    // No SUCCESS log line — but amendment A4 closes the failure gap: exactly
    // one FAILURE log line, carrying the same full inputs[] provenance a
    // success would (see the dedicated test below for its contents).
    const successCalls = infoSpy.mock.calls.filter(([, msg]) => msg === 'pr brief generated');
    expect(successCalls).toHaveLength(0);
    const failureCalls = infoSpy.mock.calls.filter(([, msg]) => msg === 'pr brief generation failed');
    expect(failureCalls).toHaveLength(1);

    const after = await app1.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(after.statusCode).toBe(200);
    expect(after.json()).toEqual(stored);

    const reviewRows = await pg.handle.db.select().from(t.reviews).where(eq(t.reviews.prId, pr.id));
    expect(reviewRows).toHaveLength(1);
    expect(reviewRows[0]).toMatchObject({ id: review!.id, kind: 'review', score: 61 });

    await app1.close();
    await app2.close();
  });

  // ---------------------------------------------------------------------
  // `pr_files` empty (PR nobody has opened) — inputs[].diff === 'unavailable',
  // never a silent empty result (`server/INSIGHTS.md:106-114`).
  // ---------------------------------------------------------------------
  it("marks the diff source unavailable (not a silent empty result) for a PR with zero pr_files rows", async () => {
    const llm = new MockLLMProvider('openai', {
      structured: draftFixture({ review_focus: [] }),
    });
    const app = await makeApp({ llm });
    const { pr } = await setupRepoAndPr();
    // Deliberately no `insertPrFile` call — `pr_files` stays empty.

    const posted = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(posted.statusCode).toBe(200);
    const body = posted.json();

    const diffInput = body.inputs.find((i: { type: string }) => i.type === 'diff');
    expect(diffInput).toMatchObject({ type: 'diff', ref: null, status: 'unavailable' });
    // AC-20 grounding has nothing to ground against — review_focus is forced empty.
    expect(body.review_focus).toEqual([]);

    await app.close();
  });

  // ---------------------------------------------------------------------
  // Amendment A4 — the one generation log line carries inputs[] in FULL,
  // not a summary count, on a SUCCESSFUL generation.
  // ---------------------------------------------------------------------
  it('writes exactly one server log line whose inputs[] carries every source with its own status on success (amendment A4, AC-45)', async () => {
    const llm = new MockLLMProvider('openai', { structured: draftFixture() });
    const app = await makeApp({ llm });
    const { pr } = await setupRepoAndPr();
    await insertPrFile(pr.id);
    const infoSpy = vi.spyOn(app.log, 'info');

    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });

    const ourCalls = infoSpy.mock.calls.filter(([, msg]) => msg === 'pr brief generated');
    expect(ourCalls).toHaveLength(1);
    const [fields] = ourCalls[0]!;
    const inputs = (fields as { inputs: { type: string; status: string }[] }).inputs;
    const byType = Object.fromEntries(inputs.map((i) => [i.type, i.status]));

    // Every one of the five sources has its OWN status entry — never
    // collapsed into a single count (A4's whole point).
    expect(byType).toMatchObject({
      intent: 'unavailable', // never derived for this PR
      blast: 'used', // MockBlast defaults to status: 'full'
      diff: 'used', // insertPrFile seeded one row
      linked_issue: 'unavailable', // no #N in the PR body
    });
    expect(fields).toMatchObject({
      outcome: 'success',
      provider: 'openai',
      model: 'gpt-4.1',
      calls: 1,
      prId: pr.id,
    });

    await app.close();
  });

  // ---------------------------------------------------------------------
  // Amendment A4 (failure-path closure) — a FAILED generation still writes
  // exactly one log line carrying inputs[] in FULL, so a postmortem holding
  // only logs can tell "the model found nothing" apart from "the source was
  // unavailable" for the one attempt that never wrote a row.
  // ---------------------------------------------------------------------
  it('writes exactly one server log line whose inputs[] carries every source with its own status when generation FAILS (amendment A4, AC-16, AC-45)', async () => {
    // Fails BriefDraft's schema — same shape `completeStructured` throws
    // after exhausting retries on invalid JSON.
    const badLlm = new MockLLMProvider('openai', { structured: { not: 'a valid draft' } });
    const app = await makeApp({ llm: badLlm });
    const { pr } = await setupRepoAndPr();
    await insertPrFile(pr.id);
    const infoSpy = vi.spyOn(app.log, 'info');

    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(502);

    // No success line, exactly one failure line.
    const successCalls = infoSpy.mock.calls.filter(([, msg]) => msg === 'pr brief generated');
    expect(successCalls).toHaveLength(0);
    const failureCalls = infoSpy.mock.calls.filter(([, msg]) => msg === 'pr brief generation failed');
    expect(failureCalls).toHaveLength(1);

    const [fields] = failureCalls[0]!;
    const inputs = (fields as { inputs: { type: string; status: string }[] }).inputs;
    const byType = Object.fromEntries(inputs.map((i) => [i.type, i.status]));

    // Same source-status provenance a success would log — collected BEFORE
    // the model call, so it survives the model call's own failure.
    expect(byType).toMatchObject({
      intent: 'unavailable',
      blast: 'used',
      diff: 'used',
      linked_issue: 'unavailable',
    });
    expect(fields).toMatchObject({
      outcome: 'failed',
      provider: 'openai',
      model: 'gpt-4.1',
      calls: 1,
      prId: pr.id,
    });

    await app.close();
  });

  // ---------------------------------------------------------------------
  // Code review fix pass 1, item 3 — `inputs[]`'s `context_doc` entries stay
  // bounded even when many documents share a leading directory segment with
  // a changed file.
  // ---------------------------------------------------------------------
  it('bounds context_doc entries in inputs[] when many documents match, rolling the remainder into one entry', async () => {
    const llm = new MockLLMProvider('openai', { structured: draftFixture({ review_focus: [] }) });
    const app = await makeApp({ llm, projectContext: new ManyDocsProjectContext(30) });
    const { pr } = await setupRepoAndPr();
    await insertPrFile(pr.id); // src/config.ts — shares the `src` leading segment with every fake doc.

    const posted = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(posted.statusCode).toBe(200);
    const body = posted.json();

    const contextDocInputs = (
      body.inputs as { type: string; ref: string | null; status: string }[]
    ).filter((i) => i.type === 'context_doc');

    // 30 relevant documents, but the report never lists all 30 individually:
    // 8 `used` (MAX_BRIEF_CONTEXT_DOCS) + at most 12 individually-named
    // `unavailable` drops (MAX_BRIEF_CONTEXT_DOC_DROPPED_INPUTS) + exactly one
    // rollup entry accounting for the rest (30 - 8 - 12 = 10 more).
    expect(contextDocInputs.length).toBeLessThan(30);
    expect(contextDocInputs.filter((i) => i.status === 'used')).toHaveLength(8);

    const named = contextDocInputs.filter(
      (i) => i.status === 'unavailable' && i.ref?.startsWith('src/doc-'),
    );
    expect(named.length).toBeLessThanOrEqual(12);

    const rollup = contextDocInputs.find(
      (i) => i.status === 'unavailable' && !i.ref?.startsWith('src/doc-'),
    );
    expect(rollup).toBeDefined();
    expect(rollup!.ref).toContain('10 more');

    // Bound applies to the persisted/returned row and to the generation log
    // line alike (amendment A4 forbids summarizing `inputs[]` — the shape
    // chosen here bounds entry COUNT, not the array's presence).
    expect(contextDocInputs).toHaveLength(8 + named.length + 1);

    await app.close();
  });

  // ---------------------------------------------------------------------
  // AC-5 — the 429 is a PER-ROUTE limit (10/min), not the global one.
  // ---------------------------------------------------------------------
  it('rate-limits POST to 10/min PER ROUTE (AC-5)', async () => {
    // The global rate-limit plugin only registers when `nodeEnv !== 'test'`
    // (`app.ts:106-110`) — that registration is what makes ANY route's
    // `config.rateLimit` do anything at all (`@fastify/rate-limit` hooks
    // `onRoute`; without registration the config is inert). Building with
    // `nodeEnv: 'development'` here registers the plugin at its 120/min
    // GLOBAL default, well above the 11 requests this test sends, so a 429
    // on request #11 can only be this ROUTE's own max: 10 override — proving
    // the limit is per-route, not the global one.
    const llm = new MockLLMProvider('openai', { structured: draftFixture() });
    const app = await makeApp({ llm, nodeEnv: 'development' });
    const { pr } = await setupRepoAndPr();
    await insertPrFile(pr.id);

    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
      statuses.push(res.statusCode);
    }

    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);

    await app.close();
  });
});
