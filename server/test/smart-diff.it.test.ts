/**
 * Smart Diff (L03) — GET /pulls/:id/smart-diff over real Postgres. Template:
 * `reviews-intent.it.test.ts` / `pulls-comments.it.test.ts`.
 *
 * The route makes no LLM/GitHub call (`service.ts`'s doc comment) — a route
 * that reads `pr_files` + already-persisted findings needs Docker (real SQL,
 * a real workspace/PR/review chain), not a mock, so this lives in the
 * integration lane rather than the unit lane.
 */
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { SmartDiff } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[smart-diff] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let repoSeq = 0;
async function setupRepoAndPr(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  files: { path: string; additions: number; deletions: number }[],
) {
  const name = `smart-diff-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 500 + repoSeq,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: files.reduce((s, f) => s + f.additions, 0),
      deletions: files.reduce((s, f) => s + f.deletions, 0),
      filesCount: files.length,
      status: 'open',
    })
    .returning();
  if (files.length > 0) {
    await db.insert(t.prFiles).values(files.map((f) => ({ prId: pr!.id, ...f })));
  }
  return { repo: repo!, pr: pr! };
}

/** Minimal required-field finding row, overridable per call. */
function findingValues(reviewId: string, overrides: Partial<typeof t.findings.$inferInsert> = {}) {
  return {
    reviewId,
    file: 'src/service.ts',
    startLine: 1,
    endLine: 1,
    severity: 'WARNING',
    category: 'correctness',
    title: 'finding',
    rationale: 'because',
    confidence: 0.8,
    ...overrides,
  };
}

d('Smart Diff route (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function appWithMockedLlm() {
    const llm = new MockLLMProvider('openai');
    return { app: buildApp({ config: config(), db: pg.handle.db, overrides: { llm: { openai: llm } } }), llm };
  }

  it('aggregates findings across every kind:review run (not just the latest), excludes dismissed findings and kind:summary rows, and groups a lock file into boilerplate', async () => {
    const { app: appPromise, llm } = appWithMockedLlm();
    const app = await appPromise;
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, [
      { path: 'pnpm-lock.yaml', additions: 3, deletions: 0 },
      { path: 'src/service.ts', additions: 20, deletions: 2 },
    ]);

    // Older review: an un-dismissed finding at line 10 — must still count.
    const [olderReview] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr.id,
        kind: 'review',
        verdict: 'approve',
        summary: null,
        score: 90,
        model: null,
        createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      })
      .returning();
    await pg.handle.db.insert(t.findings).values(findingValues(olderReview!.id, { startLine: 10 }));

    // Newer review: a dismissed finding at line 20 — must be excluded.
    const [newerReview] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr.id,
        kind: 'review',
        verdict: 'approve',
        summary: null,
        score: 95,
        model: null,
      })
      .returning();
    await pg.handle.db
      .insert(t.findings)
      .values(findingValues(newerReview!.id, { startLine: 20, dismissedAt: new Date() }));

    // A kind:'summary' row's findings must be ignored entirely, dismissed or not.
    const [summaryReview] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr.id,
        kind: 'summary',
        verdict: null,
        summary: 'summary text',
        score: null,
        model: null,
      })
      .returning();
    await pg.handle.db.insert(t.findings).values(findingValues(summaryReview!.id, { startLine: 999 }));

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as SmartDiff;

    expect(body.groups.map((g) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);

    const coreGroup = body.groups.find((g) => g.role === 'core')!;
    expect(coreGroup.files.map((f) => f.path)).toEqual(['src/service.ts']);
    // Older review's line survives, dismissed line and summary-row line do not.
    expect(coreGroup.files[0]!.finding_lines).toEqual([10]);

    const boilerplateGroup = body.groups.find((g) => g.role === 'boilerplate')!;
    expect(boilerplateGroup.files.map((f) => f.path)).toEqual(['pnpm-lock.yaml']);
    expect(boilerplateGroup.files[0]!.finding_lines).toEqual([]);

    // No new model call — the mechanical form of the "no new model call" criterion.
    expect(llm.calls).toHaveLength(0);

    await app.close();
  });

  it('returns 200 with empty finding_lines for a PR that has no review yet', async () => {
    const { app: appPromise, llm } = appWithMockedLlm();
    const app = await appPromise;
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, [
      { path: 'src/no-review.ts', additions: 4, deletions: 1 },
    ]);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as SmartDiff;

    const coreGroup = body.groups.find((g) => g.role === 'core')!;
    expect(coreGroup.files.map((f) => f.path)).toEqual(['src/no-review.ts']);
    expect(coreGroup.files[0]!.finding_lines).toEqual([]);
    expect(llm.calls).toHaveLength(0);

    await app.close();
  });

  it('404s for an unknown pull request id', async () => {
    const { app: appPromise } = appWithMockedLlm();
    const app = await appPromise;

    const res = await app.inject({ method: 'GET', url: `/pulls/${randomUUID()}/smart-diff` });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it('422s for a malformed id', async () => {
    const { app: appPromise } = appWithMockedLlm();
    const app = await appPromise;

    const res = await app.inject({ method: 'GET', url: '/pulls/not-a-uuid/smart-diff' });
    expect(res.statusCode).toBe(422);

    await app.close();
  });
});
