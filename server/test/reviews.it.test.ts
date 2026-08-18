import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import { runBus } from '../src/platform/sse.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import {
  PrMeta,
  type Intent,
  type Review,
  type StructuredRequest,
  type StructuredResult,
} from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * A unified diff touching src/config.ts (line 11 added) so grounding can keep a
 * finding on line 11 and drop one on line 999 / a non-existent file.
 */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/**
 * Same first file as `DIFF`, plus a second file — `strategy: 'map-reduce'`
 * only switches to map-reduce when `diff.files.length > 1`
 * (`reviewer-core/src/review/run.ts:117`), which is what gives the cancel
 * test below a SECOND `checkCancelled` checkpoint to abort on.
 */
const TWO_FILE_DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,
diff --git a/src/other.ts b/src/other.ts
--- a/src/other.ts
+++ b/src/other.ts
@@ -1,2 +1,3 @@
 export const a = 1;
+export const b = 2;
 export const c = 3;`;

/** A Review fixture: one valid finding (line 11), one hallucinated (line 999). */
const REVIEW_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded Stripe secret introduced.',
  score: 42,
  findings: [
    {
      id: 'f-valid',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live Stripe key is committed in source.',
      suggestion: 'Move the key to an environment variable.',
      confidence: 0.95,
      kind: 'finding',
    },
    {
      id: 'f-halluc',
      severity: 'WARNING',
      category: 'bug',
      title: 'Phantom finding on a line not in the diff',
      file: 'src/config.ts',
      start_line: 999,
      end_line: 999,
      rationale: 'This line does not exist in the diff.',
      confidence: 0.5,
      kind: 'finding',
    },
  ],
};

/**
 * L03: every review run derives PR intent once, BEFORE the per-agent loop
 * (`review_intent` defaults to `openrouter` — `platform.ts`). Every test below
 * that runs a review needs this mocked too, or `container.llm('openrouter')`
 * reaches a REAL provider using whatever key `server/.env` happens to have —
 * slow, non-deterministic, and long enough to blow `waitForPrRuns`' 10s budget.
 */
const INTENT_FIXTURE: Intent = {
  intent: 'Adds rate limiting to public endpoints.',
  in_scope: ['src/config.ts'],
  out_of_scope: [],
  risk_areas: [],
  confidence: 0.7,
  sources: [],
};

/**
 * L05 AC-24 — drives a real mid-run cancellation. `checkCancelled` only fires
 * BETWEEN map-reduce chunks (`reviewer-core/src/review/run.ts:164`), so this
 * lets the FIRST chunk's call through normally and calls `runBus.cancel()`
 * (the same process-wide singleton `container.runBus` aliases — `container.ts:92`)
 * right after, so the checkpoint before the SECOND chunk throws
 * `RunCancelledError` and the run ends up in `run-executor.ts`'s
 * failure/cancel branch. The runId isn't known until the review POST
 * responds, so the test arms `runIdBox.current` afterwards — the run's own
 * pre-work (diff load, intent derivation via a real LLM round trip, linked-
 * skill/context resolution) still has to happen before the first chunk's
 * call, which is what gives that assignment time to land first.
 */
class CancelOnSecondChunkProvider extends MockLLMProvider {
  constructor(
    structured: unknown,
    private runIdBox: { current?: string },
  ) {
    super('openai', { structured });
  }
  override async completeStructured<T>(
    req: StructuredRequest<T>,
  ): Promise<StructuredResult<T>> {
    const result = await super.completeStructured(req);
    const calls = this.calls.filter((c) => c.method === 'completeStructured').length;
    if (calls === 1 && this.runIdBox.current) runBus.cancel(this.runIdBox.current);
    return result;
  }
}

let repoSeq = 0;
async function setupRepoAndPr(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  opts: { clonePath?: string } = {},
) {
  const name = `payments-api-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({
      workspaceId,
      owner: 'acme',
      name,
      fullName: `acme/${name}`,
      ...(opts.clonePath ? { clonePath: opts.clonePath } : {}),
    })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 482,
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
  // persist the patch so the reviewer can reconstruct a diff (MockGit also returns one)
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  });
  return { repo: repo!, pr: pr! };
}

d('A2 reviews + agents (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function appWith(structured: unknown, provider: 'openai' | 'anthropic' = 'openai') {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: {
          [provider]: new MockLLMProvider(provider, { structured }),
          // Same trick `conventions.it.test.ts` uses: the mock's own `.id` label
          // doesn't need to match the override key it's registered under.
          openrouter: new MockLLMProvider('openai', { structured: INTENT_FIXTURE }),
        },
      },
    });
  }

  it('agents CRUD', async () => {
    const app = await appWith(REVIEW_FIXTURE);

    const created = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: 'Test Reviewer',
        provider: 'openai',
        model: 'gpt-4.1',
        system_prompt: 'You are a reviewer.',
      },
    });
    expect(created.statusCode).toBe(201);
    const agent = created.json();
    expect(agent.version).toBe(1);

    const list = (await app.inject({ method: 'GET', url: '/agents' })).json();
    expect(list.some((a: { id: string }) => a.id === agent.id)).toBe(true);

    // a config change bumps version
    const updated = (
      await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}`,
        payload: { system_prompt: 'Updated prompt.' },
      })
    ).json();
    expect(updated.version).toBe(2);

    await app.close();
  });

  it('runs a review: map-reduce + grounding drops the hallucinated finding, keeps the valid one', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Sec', provider: 'openai', model: 'gpt-4.1', system_prompt: 'sec' },
      })
    ).json();

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.runs).toHaveLength(1);

    // runReview is fire-and-forget: wait for the background run, then read the
    // persisted reviews (the POST returns runIds, not the reviews themselves).
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    expect(reviews).toHaveLength(1);

    const review = reviews[0];
    expect(review.verdict).toBe('request_changes');
    // Score is derived from the GROUNDED findings, not the model's self-reported
    // 42: grounding keeps one CRITICAL (line 11) ⇒ 100 − 35 = 65.
    expect(review.score).toBe(65);
    // grounding kept only the valid finding (line 11), dropped the line-999 one
    expect(review.findings).toHaveLength(1);
    expect(review.findings[0].file).toBe('src/config.ts');
    expect(review.findings[0].start_line).toBe(11);

    // a run_traces document was written (single doc)
    const runId = body.runs[0].run_id;
    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.config.model).toBe('gpt-4.1');
    expect(trace.stats.grounding).toBe('1/2 passed');
    expect(trace.log.length).toBeGreaterThan(0);

    // agent_runs row populated for A5 to aggregate
    const [run] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
    expect(run!.status).toBe('done');
    expect(run!.findingsCount).toBe(1);
    expect(run!.grounding).toBe('1/2 passed');

    await app.close();
  });

  it('L05: a document attached to the agent reaches the prompt and is recorded in the trace', async () => {
    // Step 11 seam check — Lane B reported the wire shapes match what Lane A's
    // routes serve; this proves the harder claim the plan's step 11 asks for:
    // an attached path actually reaches `reviewPullRequest`'s prompt and comes
    // back out through `RunTrace.specs_read` / `prompt_assembly.specs`, over a
    // real container (`container.projectContext` is NOT overridden here), not
    // a hermetic stub like `skills-run-path.test.ts` uses.
    const clonePath = await mkdtemp(join(tmpdir(), 'devdigest-reviews-context-'));
    try {
      await mkdir(join(clonePath, 'specs'), { recursive: true });
      await writeFile(
        join(clonePath, 'specs', 'security.md'),
        '# Security baseline\n\nAlways read secrets from the environment.',
        'utf8',
      );

      const app = await appWith(REVIEW_FIXTURE);
      const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, { clonePath });

      const agent = (
        await app.inject({
          method: 'POST',
          url: '/agents',
          payload: { name: 'Context Reviewer', provider: 'openai', model: 'gpt-4.1', system_prompt: 'sec' },
        })
      ).json();

      const attach = await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/context`,
        payload: { paths: ['specs/security.md'] },
      });
      expect(attach.statusCode).toBe(200);

      const body = (
        await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } })
      ).json();
      const runId = body.runs[0].run_id;
      await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

      const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
      // Exactly the attached path, in prompt order (AC-22).
      expect(trace.specs_read).toEqual(['specs/security.md']);
      // The literal text sent to the model (AC-23/AC-24) — reviewer-core wraps
      // each packed doc in `<untrusted source="spec-N">`, itself nested under
      // the `## Project context` heading it renders around the WHOLE
      // `prompt_assembly.specs` block, not inside it.
      expect(trace.prompt_assembly.specs).toContain('Always read secrets from the environment.');
      expect(trace.prompt_assembly.specs).toContain('<untrusted source="spec-0">');
      expect(trace.prompt_assembly.specs).toContain('specs/security.md');

      await app.close();
    } finally {
      await rm(clonePath, { recursive: true, force: true });
    }
  });

  it('L05: an agent with no attachments gets a null specs slot — no section, no cost', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'No Context', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();

    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } })
    ).json();
    const runId = body.runs[0].run_id;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.specs_read).toEqual([]);
    expect(trace.prompt_assembly.specs).toBeNull();

    await app.close();
  });

  it('L05: own docs come first, then an enabled linked skill\'s — deduped on first occurrence', async () => {
    // AC-16/AC-17/AC-22 — merge order is "own docs, then each ENABLED linked
    // skill's, in link order", with the first occurrence of a shared path kept
    // (`modules/context/service.ts:262`, `dedupeKeepFirst`).
    const clonePath = await mkdtemp(join(tmpdir(), 'devdigest-reviews-context-order-'));
    try {
      await mkdir(join(clonePath, 'specs'), { recursive: true });
      await writeFile(
        join(clonePath, 'specs', 'agent-doc.md'),
        '# Agent-only doc\n\nOnly the agent attaches this.',
        'utf8',
      );
      await writeFile(
        join(clonePath, 'specs', 'shared.md'),
        '# Shared doc\n\nBoth the agent and the skill attach this path.',
        'utf8',
      );
      await writeFile(
        join(clonePath, 'specs', 'skill-doc.md'),
        '# Skill-only doc\n\nOnly the skill attaches this.',
        'utf8',
      );

      const app = await appWith(REVIEW_FIXTURE);
      const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, { clonePath });

      const agent = (
        await app.inject({
          method: 'POST',
          url: '/agents',
          payload: { name: 'Order Reviewer', provider: 'openai', model: 'gpt-4.1', system_prompt: 'sec' },
        })
      ).json();

      const skill = (
        await app.inject({
          method: 'POST',
          url: '/skills',
          payload: { name: 'Order Skill', body: 'Follow the house style.' },
        })
      ).json();
      expect(skill.enabled).toBe(true); // the kill switch this merge depends on

      // Own docs first: agent-doc.md, then shared.md (the path the skill also attaches).
      const attachAgent = await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/context`,
        payload: { paths: ['specs/agent-doc.md', 'specs/shared.md'] },
      });
      expect(attachAgent.statusCode).toBe(200);

      // The skill re-attaches the SAME shared.md (first occurrence must win) plus its own doc.
      const attachSkill = await app.inject({
        method: 'POST',
        url: `/skills/${skill.id}/context`,
        payload: { paths: ['specs/shared.md', 'specs/skill-doc.md'] },
      });
      expect(attachSkill.statusCode).toBe(200);

      const linked = await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/skills`,
        payload: { skill_ids: [skill.id] },
      });
      expect(linked.statusCode).toBe(200);

      const body = (
        await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } })
      ).json();
      const runId = body.runs[0].run_id;
      await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

      const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
      // Own docs first (agent-doc.md, shared.md), THEN the skill's docs — with
      // shared.md kept only once, at its first (agent's) occurrence.
      expect(trace.specs_read).toEqual(['specs/agent-doc.md', 'specs/shared.md', 'specs/skill-doc.md']);
      expect(trace.prompt_assembly.specs).toContain('Agent-only doc');
      expect(trace.prompt_assembly.specs).toContain('Skill-only doc');
      // shared.md's content appears exactly once — the dedupe didn't just hide
      // the duplicate PATH while still packing the content twice.
      const sharedOccurrences = (
        (trace.prompt_assembly.specs as string).match(/Shared doc/g) ?? []
      ).length;
      expect(sharedOccurrences).toBe(1);

      await app.close();
    } finally {
      await rm(clonePath, { recursive: true, force: true });
    }
  });

  it('L05: an attached document adds zero LLM calls (AC-21, NFR "reading documents does not add model calls")', async () => {
    const provider = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: {
          openai: provider,
          openrouter: new MockLLMProvider('openai', { structured: INTENT_FIXTURE }),
        },
      },
    });
    const callsOf = (method: string) => provider.calls.filter((c) => c.method === method).length;

    // Baseline: no attachments — exactly ONE completeStructured call (single-pass,
    // one changed file).
    const { pr: prBaseline } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agentBaseline = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'No Context Calls', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    await app.inject({
      method: 'POST',
      url: `/pulls/${prBaseline.id}/review`,
      payload: { agentId: agentBaseline.id },
    });
    await waitForPrRuns(pg.handle.db, prBaseline.id, { expected: 1 });
    const callsAfterBaseline = callsOf('completeStructured');
    expect(callsAfterBaseline).toBe(1);

    // Same shape, but with a document attached — reading it from disk must add
    // ZERO provider calls: the delta from baseline is still exactly 1.
    const clonePath = await mkdtemp(join(tmpdir(), 'devdigest-reviews-context-calls-'));
    try {
      await mkdir(join(clonePath, 'specs'), { recursive: true });
      await writeFile(join(clonePath, 'specs', 'note.md'), '# Note\n\nSome guidance.', 'utf8');

      const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, { clonePath });
      const agent = (
        await app.inject({
          method: 'POST',
          url: '/agents',
          payload: { name: 'With Context Calls', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
        })
      ).json();
      const attach = await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/context`,
        payload: { paths: ['specs/note.md'] },
      });
      expect(attach.statusCode).toBe(200);

      const body = (
        await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } })
      ).json();
      const runId = body.runs[0].run_id;
      await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

      // Fix pass 2, item 3: the call-count delta alone holds whether the
      // document was read, skipped, or never resolved — a broken Project
      // Context would leave this test green. Pin that the document actually
      // reached the prompt (its sibling above at 'own docs come first…' does
      // the same via `trace.specs_read` / `trace.prompt_assembly.specs`), so
      // the "zero extra calls" number rests on a real attachment, not a
      // no-op.
      const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
      expect(trace.specs_read).toEqual(['specs/note.md']);
      expect(trace.prompt_assembly.specs).toContain('specs/note.md');
      expect(trace.prompt_assembly.specs).toContain('Some guidance.');

      expect(callsOf('completeStructured') - callsAfterBaseline).toBe(1);
    } finally {
      await rm(clonePath, { recursive: true, force: true });
    }

    await app.close();
  });

  it('L05: a cancelled run still records the docs read before the checkpoint threw (AC-24)', async () => {
    const clonePath = await mkdtemp(join(tmpdir(), 'devdigest-reviews-context-cancel-'));
    try {
      await mkdir(join(clonePath, 'specs'), { recursive: true });
      await writeFile(
        join(clonePath, 'specs', 'security.md'),
        '# Security baseline\n\nAlways read secrets from the environment.',
        'utf8',
      );

      const runIdBox: { current?: string } = {};
      const provider = new CancelOnSecondChunkProvider(REVIEW_FIXTURE, runIdBox);
      const app = await buildApp({
        config: config(),
        db: pg.handle.db,
        overrides: {
          embedder: new MockEmbedder(),
          git: new MockGitClient({ diff: TWO_FILE_DIFF }),
          llm: {
            openai: provider,
            openrouter: new MockLLMProvider('openai', { structured: INTENT_FIXTURE }),
          },
        },
      });
      const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, { clonePath });

      const agent = (
        await app.inject({
          method: 'POST',
          url: '/agents',
          payload: {
            name: 'Cancel Mid-Run',
            provider: 'openai',
            model: 'gpt-4.1',
            system_prompt: 'sec',
            strategy: 'map-reduce',
          },
        })
      ).json();

      const attach = await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/context`,
        payload: { paths: ['specs/security.md'] },
      });
      expect(attach.statusCode).toBe(200);

      const body = (
        await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } })
      ).json();
      const runId = body.runs[0].run_id;
      // Arm the cancellation only NOW that the runId exists — see the class
      // comment above for why the run's own pre-work gives this time to land
      // before the first chunk's LLM call.
      runIdBox.current = runId;

      await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

      const [run] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
      expect(run!.status).toBe('cancelled');

      const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
      // Project Context is resolved ONCE, before the map-reduce loop even
      // starts (`run-executor.ts:264-270`, hoisted into `contextSpecs`/
      // `contextSpecsRead`) — a cancellation mid-loop must not blank it out.
      expect(trace.specs_read).toEqual(['specs/security.md']);
      expect(trace.prompt_assembly.specs).toContain('specs/security.md');
      expect(trace.prompt_assembly.specs).toContain('Always read secrets from the environment.');

      await app.close();
    } finally {
      await rm(clonePath, { recursive: true, force: true });
    }
  });

  it('PR list surfaces a per-severity finding_counts breakdown', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    // Unreviewed PR → all-zero counts (never null, so the column can render).
    const before = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })).json();
    expect(PrMeta.array().safeParse(before).success).toBe(true);
    expect(before.find((p: PrMeta) => p.number === pr.number)!.finding_counts).toEqual({
      critical: 0,
      warning: 0,
      suggestion: 0,
    });

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Counter', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    // Grounding keeps only the CRITICAL finding (line 11); the WARNING one sat
    // on line 999 and was dropped, so the counts mirror what is persisted.
    const after = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })).json();
    expect(after.find((p: PrMeta) => p.number === pr.number)!.finding_counts).toEqual({
      critical: 1,
      warning: 0,
      suggestion: 0,
    });

    await app.close();
  });

  it('dual-provider structured output: anthropic provider returns the same Review shape', async () => {
    const app = await appWith(REVIEW_FIXTURE, 'anthropic');
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Claude Rev', provider: 'anthropic', model: 'claude-x', system_prompt: 'rev' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    expect(reviews[0].findings).toHaveLength(1);
    expect(reviews[0].model).toBe('claude-x');
    await app.close();
  });

  it('finding actions: accept, dismiss', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'ActAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    const findingId = reviews[0].findings[0].id;

    const accepted = (
      await app.inject({ method: 'POST', url: `/findings/${findingId}/accept` })
    ).json();
    expect(accepted.finding.accepted_at).not.toBeNull();

    const dismissed = (
      await app.inject({ method: 'POST', url: `/findings/${findingId}/dismiss` })
    ).json();
    expect(dismissed.finding.dismissed_at).not.toBeNull();
    expect(dismissed.finding.accepted_at).toBeNull();

    await app.close();
  });

  it('SSE: /runs/:id/events streams events and completes', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'SseAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    // The run is synchronous; events are buffered on the bus. Subscribing after
    // the run still replays the buffer (replay-first semantics), then completes.
    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } })
    ).json();
    const runId = body.runs[0].run_id;

    const sse = await app.inject({ method: 'GET', url: `/runs/${runId}/events` });
    expect(sse.statusCode).toBe(200);
    expect(sse.headers['content-type']).toContain('text/event-stream');
    // The replay buffer should contain our log lines as SSE `data:` frames.
    expect(sse.payload).toContain('Starting review');
    expect(sse.payload).toContain('Citation grounding');
    await app.close();
  });

  it('run all enabled agents reviews with each enabled agent', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { all: true } })
    ).json();
    // seed has 2 enabled agents; we may have created more above in this PR's ws.
    expect(body.runs.length).toBeGreaterThanOrEqual(2);
    await app.close();
  });
});
