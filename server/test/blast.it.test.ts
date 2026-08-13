/**
 * Blast Radius (L04) — GET /pulls/:id/blast over real Postgres. Template:
 * `smart-diff.it.test.ts`.
 *
 * This is the acceptance scenario in miniature: a PR that changes a shared
 * helper must surface at least two real callers and one HTTP endpoint, read
 * from the persistent index — no clone parsing, no LLM call. The seeded rows
 * stand in for what the indexer writes (`symbols`, `references` with a
 * resolved `decl_file`, `file_rank`, `file_edges`, `file_facts`).
 */
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { BlastRadius } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[blast] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const HELPER = 'src/lib/rate-limit.ts';
const CALLER_A = 'src/api/public/index.ts';
const CALLER_B = 'src/server.ts';
/** Imports CALLER_A but never names the changed symbol — reachable at level 2. */
const MOUNTER = 'src/jobs/reset-buckets.ts';

let repoSeq = 0;

async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `blast-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 600 + repoSeq,
      title: 'Tighten the shared rate-limit helper',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 12,
      deletions: 3,
      filesCount: 1,
      status: 'open',
    })
    .returning();
  await db.insert(t.prFiles).values({ prId: pr!.id, path: HELPER, additions: 12, deletions: 3 });
  return { repo: repo!, pr: pr! };
}

/** Write what the indexer would have written for the scenario above. */
async function seedIndex(
  db: PgFixture['handle']['db'],
  repoId: string,
  status: 'full' | 'partial',
) {
  await db.insert(t.repoIndexState).values({
    repoId,
    lastIndexedSha: 'a1b2c3d4',
    indexerVersion: 2,
    status,
    filesIndexed: 4,
    filesSkipped: 0,
  });

  await db.insert(t.symbols).values([
    { repoId, path: HELPER, name: 'rateLimit', kind: 'function', line: 10, endLine: 40, exported: true },
    { repoId, path: CALLER_A, name: 'publicRouter', kind: 'function', line: 5, endLine: 60, exported: true },
    { repoId, path: CALLER_B, name: 'buildServer', kind: 'function', line: 70, endLine: 120, exported: true },
  ]);

  // Two resolved callers of the changed symbol, in two different files.
  await db.insert(t.references).values([
    { repoId, fromPath: CALLER_A, toSymbol: 'rateLimit', line: 23, declFile: HELPER },
    { repoId, fromPath: CALLER_B, toSymbol: 'rateLimit', line: 88, declFile: HELPER },
  ]);

  // getResolvedCallers inner-joins file_rank, so every caller file needs a row.
  await db.insert(t.fileRank).values([
    { repoId, filePath: HELPER, pagerank: 0.9, hotness: 0, rank: 0.9, percentile: 99 },
    { repoId, filePath: CALLER_A, pagerank: 0.6, hotness: 0, rank: 0.6, percentile: 80 },
    { repoId, filePath: CALLER_B, pagerank: 0.3, hotness: 0, rank: 0.3, percentile: 50 },
    { repoId, filePath: MOUNTER, pagerank: 0.1, hotness: 0, rank: 0.1, percentile: 20 },
  ]);

  // Reverse graph: A imports the helper (level 1), the cron module imports A (level 2).
  await db.insert(t.fileEdges).values([
    { repoId, fromFile: CALLER_A, toFile: HELPER },
    { repoId, fromFile: CALLER_B, toFile: HELPER },
    { repoId, fromFile: MOUNTER, toFile: CALLER_A },
  ]);

  await db.insert(t.fileFacts).values([
    { repoId, filePath: CALLER_A, endpoints: ['GET /api/public/items'], crons: [] },
    { repoId, filePath: CALLER_B, endpoints: ['GET /api/public/health'], crons: [] },
    { repoId, filePath: MOUNTER, endpoints: [], crons: ['reset-rate-buckets (hourly)'] },
  ]);
}

d('Blast Radius route (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));
  });
  afterAll(async () => {
    await pg?.stop();
  });

  /**
   * `blast_summary` defaults to `openrouter` (`platform.ts`), and an unmocked
   * override there reaches the real provider (server INSIGHTS.md, 2026-08-11)
   * — so the same mock is registered under both keys.
   */
  function appWithMockedLlm() {
    const llm = new MockLLMProvider('openai');
    return {
      app: buildApp({
        config: config(),
        db: pg.handle.db,
        overrides: { llm: { openai: llm, openrouter: llm } },
      }),
      llm,
    };
  }

  it('maps a changed helper to its callers and the endpoints/crons they reach — without an LLM call', async () => {
    const { app: appPromise, llm } = appWithMockedLlm();
    const app = await appPromise;
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await seedIndex(pg.handle.db, repo.id, 'full');

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as BlastRadius;

    expect(body.status).toBe('full');
    expect(body.reason).toBeUndefined();
    expect(body.changed_symbols.map((s) => s.name)).toContain('rateLimit');

    const impact = body.downstream.find((dn) => dn.symbol === 'rateLimit')!;
    // Acceptance: at least two real callers...
    expect(impact.callers.length).toBeGreaterThanOrEqual(2);
    expect(impact.callers.map((c) => c.file).sort()).toEqual([CALLER_A, CALLER_B]);
    expect(impact.callers.find((c) => c.file === CALLER_A)?.line).toBe(23);
    // ...and at least one HTTP endpoint.
    expect(impact.endpoints_affected).toContain('GET /api/public/items');
    // Reached only through the reverse import graph's second level.
    expect(impact.crons_affected).toContain('reset-rate-buckets (hourly)');

    // Rank-ordered: the more central caller file first.
    expect(impact.callers[0]?.file).toBe(CALLER_A);

    expect(llm.calls).toHaveLength(0);

    await app.close();
  });

  it('reports a partial index as partial while still returning the data', async () => {
    const { app: appPromise } = appWithMockedLlm();
    const app = await appPromise;
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await seedIndex(pg.handle.db, repo.id, 'partial');

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as BlastRadius;

    expect(body.status).toBe('partial');
    expect(body.downstream.length).toBeGreaterThan(0);

    await app.close();
  });

  it('reports an unindexed repo as degraded with a reason, not as an empty map', async () => {
    const { app: appPromise } = appWithMockedLlm();
    const app = await appPromise;
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId); // no seedIndex

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as BlastRadius;

    expect(body.status).toBe('degraded');
    expect(body.reason).toBeTruthy();

    await app.close();
  });

  it('404s for an unknown pull request id', async () => {
    const { app: appPromise } = appWithMockedLlm();
    const app = await appPromise;

    const res = await app.inject({ method: 'GET', url: `/pulls/${randomUUID()}/blast` });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it('422s for a malformed id', async () => {
    const { app: appPromise } = appWithMockedLlm();
    const app = await appPromise;

    const res = await app.inject({ method: 'GET', url: '/pulls/not-a-uuid/blast' });
    expect(res.statusCode).toBe(422);

    await app.close();
  });

  it('summary route spends exactly one model call', async () => {
    const { app: appPromise, llm } = appWithMockedLlm();
    const app = await appPromise;
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await seedIndex(pg.handle.db, repo.id, 'full');

    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/blast/summary` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('summary');
    expect(llm.calls).toHaveLength(1);

    await app.close();
  });
});
