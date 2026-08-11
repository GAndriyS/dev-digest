import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { Intent } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[reviews-intent] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * A unified diff touching src/config.ts — same shape `reviews.it.test.ts`
 * uses, since `deriveIntentNow` calls `loadDiff` before classifying.
 */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/**
 * L03: `review_intent` defaults to `openrouter` (`platform.ts`). Every server
 * INSIGHTS.md (2026-08-11): an unmocked `openrouter` override reaches
 * `container.llm()`'s real-provider fallback (`server/.env` on this machine
 * holds real keys) and the test times out on a real network round-trip
 * instead of failing fast — mock it under the OVERRIDE key, not the mock's
 * own `.id` (same trick `conventions.it.test.ts` uses).
 */
const INTENT_FIXTURE: Intent = {
  intent: 'Adds rate limiting to public endpoints.',
  in_scope: ['src/config.ts'],
  out_of_scope: [],
  risk_areas: ['auth bypass on public routes'],
  confidence: 0.75,
  sources: [{ type: 'description', status: 'used' }],
};

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `payments-api-intent-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 900 + repoSeq,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: 'Add rate limiting. Closes #471.',
    })
    .returning();
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  });
  return { repo: repo!, pr: pr! };
}

d('PR intent endpoints (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function appWithMockedIntent() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: {
          // Keyed by the OVERRIDE slot (`review_intent`'s default provider),
          // not by the mock's own `.id` — the trap `server/INSIGHTS.md`
          // (2026-08-11) documents.
          openrouter: new MockLLMProvider('openai', { structuredBySchema: { Intent: INTENT_FIXTURE } }),
        },
      },
    });
  }

  it('GET before any derive returns null, not 404', async () => {
    const app = await appWithMockedIntent();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/intent` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();

    await app.close();
  });

  it('POST derives and persists a row carrying model, head_sha, tokens and cost; GET afterwards returns it', async () => {
    const app = await appWithMockedIntent();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const posted = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/intent` });
    expect(posted.statusCode).toBe(200);
    const record = posted.json();

    expect(record.intent).toBe(INTENT_FIXTURE.intent);
    expect(record.in_scope).toEqual(INTENT_FIXTURE.in_scope);
    expect(record.risk_areas).toEqual(INTENT_FIXTURE.risk_areas);
    expect(record.model).toBe('deepseek/deepseek-v4-flash');
    expect(record.head_sha).toBe(pr.headSha);
    expect(typeof record.tokens_in).toBe('number');
    expect(record.tokens_in).toBeGreaterThan(0);
    expect(typeof record.tokens_out).toBe('number');
    expect(record.tokens_out).toBeGreaterThan(0);
    expect(record.cost_usd).not.toBeNull();

    // Persisted, not just returned: a fresh GET must see the same row.
    const got = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/intent` });
    expect(got.statusCode).toBe(200);
    const gotRecord = got.json();
    expect(gotRecord.intent).toBe(INTENT_FIXTURE.intent);
    expect(gotRecord.model).toBe(record.model);
    expect(gotRecord.head_sha).toBe(record.head_sha);
    expect(gotRecord.tokens_in).toBe(record.tokens_in);
    expect(gotRecord.tokens_out).toBe(record.tokens_out);
    expect(gotRecord.cost_usd).toBe(record.cost_usd);

    await app.close();
  });

  it('an unknown PR id 404s on both GET and POST', async () => {
    const app = await appWithMockedIntent();
    const unknownId = randomUUID();

    const got = await app.inject({ method: 'GET', url: `/pulls/${unknownId}/intent` });
    expect(got.statusCode).toBe(404);

    const posted = await app.inject({ method: 'POST', url: `/pulls/${unknownId}/intent` });
    expect(posted.statusCode).toBe(404);

    await app.close();
  });
});
