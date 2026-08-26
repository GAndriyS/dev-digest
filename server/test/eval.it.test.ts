import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import { AgentEvalBatch, EvalCase, EvalDashboard, EvalDashboardOverview } from '@devdigest/shared';
import type { GitClient, GitHubClient, LLMProvider, StructuredRequest, StructuredResult } from '@devdigest/shared';
import type { FastifyInstance } from 'fastify';
import { BATCH_TABLE_LIMIT } from '../src/modules/eval/constants.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[eval] Docker not available — skipping integration tests.');
}

/**
 * Wave 6 (plan step 15) — the integration pass over the whole eval pipeline,
 * across the seam every wave-4/5 lane implemented independently
 * (INSIGHTS root#2026-08-04: unit tests on both sides of a seam always agree
 * with themselves). Covers: "Turn into eval case" (accepted/dismissed/no-diff/
 * double-click), delete cascade, the batch runner (batch_id/agent_version,
 * cost/call-count, partial failure, zero GitHub/git calls), the Eval Dashboard
 * owner_kind boundary, the version-snapshot 404, and route+contract seam
 * checks against the client hooks (`client/src/lib/hooks/eval.ts`).
 *
 * Every provider slot is mocked (openai/anthropic/openrouter) — INSIGHTS
 * server#2026-08-11: a missed slot silently reaches the real provider.
 */

/**
 * Design-fidelity plan (l06-evals-eval-dashboard-design-fidelity), step 9 —
 * cross-lane seam check that needs no database: `EvalAgentSummary.trend`
 * (AC-41) was added to BOTH `@devdigest/shared` copies in one step
 * (`AGENTS.md`: "@devdigest/shared exists twice"). This reads both files'
 * source directly (no module resolution, no alias — mirrors
 * `contracts.test.ts`'s Onboarding-block check) and pins the two byte-
 * identical for this field. Runs regardless of Docker availability, unlike
 * the rest of this file, because it needs no live database.
 */
describe('eval/overview contract — EvalAgentSummary mirror (no DB required)', () => {
  it('the client copy of EvalAgentSummary matches the server copy field-for-field (AC-41)', () => {
    const extractEvalAgentSummaryBlock = (src: string): string => {
      const match = src.match(
        /\/\*\* One agent row in the Eval Dashboard overview[\s\S]*?export type EvalAgentSummary = z\.infer<typeof EvalAgentSummary>;/,
      );
      if (!match) throw new Error('EvalAgentSummary block marker not found');
      return match[0].trim();
    };
    const testDir = dirname(fileURLToPath(import.meta.url));
    const serverSrc = readFileSync(resolve(testDir, '../src/vendor/shared/contracts/eval-ci.ts'), 'utf8');
    const clientSrc = readFileSync(
      resolve(testDir, '../../client/src/vendor/shared/contracts/eval-ci.ts'),
      'utf8',
    );
    const serverBlock = extractEvalAgentSummaryBlock(serverSrc);
    const clientBlock = extractEvalAgentSummaryBlock(clientSrc);
    expect(clientBlock).toBe(serverBlock);
  });
});

d('eval module (SPEC-05)', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp(llmOverride?: LLMProvider, extra?: { git?: GitClient; github?: GitHubClient }) {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: extra?.git ?? new MockGitClient(),
        github: extra?.github ?? new MockGitHubClient(),
        // Mock EVERY provider slot the runner could resolve, not just the one
        // the test's agent happens to use.
        ...(llmOverride
          ? { llm: { openai: llmOverride, anthropic: llmOverride, openrouter: llmOverride } }
          : {}),
      },
    });
  }

  async function defaultWorkspaceId(): Promise<string> {
    const { db } = pg.handle;
    const [ws] = await db.select().from(t.workspaces).where(eq(t.workspaces.name, 'default'));
    return ws!.id;
  }

  async function pr482Id(): Promise<string> {
    const { db } = pg.handle;
    const [pr] = await db.select().from(t.pullRequests).where(eq(t.pullRequests.number, 482));
    return pr!.id;
  }

  /** A minimal, realistic unified-diff patch for `path` — one added line at
   *  new-side line 12 (matches the grounding-gate fixture pattern already
   *  proven in `skills-eval.test.ts`). */
  function makeDiffPatch(path: string): string {
    return [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      '@@ -10,3 +10,4 @@',
      ' export const config = {',
      '   value: 1,',
      '+  flag: true,',
      ' };',
    ].join('\n');
  }
  const FIXTURE_LINE = 12;

  /** Create an agent through the real route (mirrors agents-versions.it.test.ts). */
  async function createAgent(app: FastifyInstance, name: string): Promise<{ id: string; version: number }> {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name,
        provider: 'openai',
        model: 'gpt-4o-mini',
        system_prompt: 'Review the diff.',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    return { id: body.id, version: body.version };
  }

  /** Insert a decided finding on `path` for `prId`, owned (via its review) by
   *  `agentId`. `decision` is 'accepted' | 'dismissed'. Returns the finding id. */
  async function insertDecidedFinding(opts: {
    prId: string;
    workspaceId: string;
    agentId: string;
    file: string;
    decision: 'accepted' | 'dismissed';
  }): Promise<string> {
    const { db } = pg.handle;
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId: opts.workspaceId,
        prId: opts.prId,
        agentId: opts.agentId,
        kind: 'review',
        verdict: 'comment',
        summary: 'x',
        score: 80,
        model: 'seed',
      })
      .returning();
    const [finding] = await db
      .insert(t.findings)
      .values({
        reviewId: review!.id,
        file: opts.file,
        startLine: FIXTURE_LINE,
        endLine: FIXTURE_LINE,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded key',
        rationale: 'A live key was added in this diff.',
        confidence: 0.95,
        ...(opts.decision === 'accepted' ? { acceptedAt: new Date() } : { dismissedAt: new Date() }),
      })
      .returning();
    return finding!.id;
  }

  // ---- AC-3 / AC-4 — "Turn into eval case" -----------------------------

  it('mints a case from an ACCEPTED finding: owner = review.agentId, input_diff = the file patch, one expected finding (AC-3)', async () => {
    const app = await makeApp();
    const workspaceId = await defaultWorkspaceId();
    const prId = await pr482Id();
    const agent = await createAgent(app, 'AC3 Owner');
    const agentId = agent.id;

    const path = 'src/eval/ac3-accepted.ts';
    const patch = makeDiffPatch(path);
    await pg.handle.db.insert(t.prFiles).values({ prId, path, additions: 1, deletions: 0, patch });

    const findingId = await insertDecidedFinding({
      prId,
      workspaceId,
      agentId,
      file: path,
      decision: 'accepted',
    });

    const res = await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    expect(res.statusCode).toBe(201);
    const created = res.json();
    expect(created.owner_kind).toBe('agent');
    expect(created.owner_id).toBe(agentId);
    expect(created.input_diff).toBe(patch);
    expect(created.expected_output.findings).toHaveLength(1);
    expect(created.expected_output.findings[0]).toMatchObject({
      file: path,
      start_line: FIXTURE_LINE,
      end_line: FIXTURE_LINE,
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded key',
    });
    expect(created.source_finding_id).toBe(findingId);

    await app.close();
  });

  it('mints a case from a DISMISSED finding: expected findings = [] and a human notes reference (AC-4)', async () => {
    const app = await makeApp();
    const workspaceId = await defaultWorkspaceId();
    const prId = await pr482Id();
    const agent = await createAgent(app, 'AC4 Owner');

    const path = 'src/eval/ac4-dismissed.ts';
    const patch = makeDiffPatch(path);
    await pg.handle.db.insert(t.prFiles).values({ prId, path, additions: 1, deletions: 0, patch });

    const findingId = await insertDecidedFinding({
      prId,
      workspaceId,
      agentId: agent.id,
      file: path,
      decision: 'dismissed',
    });

    const res = await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    expect(res.statusCode).toBe(201);
    const created = res.json();
    expect(created.expected_output.findings).toEqual([]);
    expect(created.notes).toContain(path);
    expect(created.notes).toContain('Hardcoded key');
    // The scorer never reads notes — that rule lives in helpers.ts, not tested
    // here, but the human-reference text living somewhere other than
    // `expected_output` is what this assertion pins.
    await app.close();
  });

  // ---- AC-5 — refuse without a diff, on BOTH paths ----------------------

  it('refuses to mint a case when the file patch is empty (pr_files row present, patch null) (AC-5)', async () => {
    const app = await makeApp();
    const workspaceId = await defaultWorkspaceId();
    const prId = await pr482Id();
    const agent = await createAgent(app, 'AC5 Empty-patch Owner');

    // Seeded PR #482 pr_files rows carry no `patch` at all (INSIGHTS
    // server#2026-08-05) — src/config.ts is one of them.
    const findingId = await insertDecidedFinding({
      prId,
      workspaceId,
      agentId: agent.id,
      file: 'src/config.ts',
      decision: 'accepted',
    });

    const res = await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    expect(res.statusCode).toBe(422);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.message).not.toContain('sk_live');
    expect(typeof body.error.message).toBe('string');
    await app.close();
  });

  it('refuses to mint a case when the file has no pr_files row at all (AC-5, second path)', async () => {
    const app = await makeApp();
    const workspaceId = await defaultWorkspaceId();
    const prId = await pr482Id();
    const agent = await createAgent(app, 'AC5 No-row Owner');

    // INSIGHTS server#2026-08-13: pr_files is populated as a side effect of
    // GET /pulls/:id — a file nobody ever opened has zero rows, not an empty one.
    const findingId = await insertDecidedFinding({
      prId,
      workspaceId,
      agentId: agent.id,
      file: 'src/eval/never-imported.ts',
      decision: 'accepted',
    });

    const res = await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  // ---- AC-6 — double click is idempotent --------------------------------

  it('a second "Turn into eval case" click returns 200 with the SAME case, not a new one (AC-6)', async () => {
    const app = await makeApp();
    const workspaceId = await defaultWorkspaceId();
    const prId = await pr482Id();
    const agent = await createAgent(app, 'AC6 Owner');

    const path = 'src/eval/ac6-double-click.ts';
    const patch = makeDiffPatch(path);
    await pg.handle.db.insert(t.prFiles).values({ prId, path, additions: 1, deletions: 0, patch });
    const findingId = await insertDecidedFinding({
      prId,
      workspaceId,
      agentId: agent.id,
      file: path,
      decision: 'accepted',
    });

    const first = await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    expect(first.statusCode).toBe(201);
    const firstId = first.json().id as string;

    const second = await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(firstId);

    const list = (
      await app.inject({ method: 'GET', url: `/eval-cases?owner_kind=agent&owner_id=${agent.id}` })
    ).json() as { id: string }[];
    expect(list.filter((c) => c.id === firstId)).toHaveLength(1);

    await app.close();
  });

  // ---- PUT /eval-cases/:id — expected_output union (fix pass, item 1) ----
  // Regression: the shared `PUT` (registered on `skills/routes.ts`) used to
  // validate `expected_output` with the SKILL shape only (`severity`
  // required, non-strict `z.object` — silently STRIPPING `file`/`start_line`/
  // `end_line`). A round-trip PUT on an agent case minted from a finding
  // would silently corrupt its scorable expectation.

  it('PUT on a finding-minted agent case round-trips expected_output WITHOUT stripping file/start_line/end_line', async () => {
    const app = await makeApp();
    const workspaceId = await defaultWorkspaceId();
    const prId = await pr482Id();
    const agent = await createAgent(app, 'Fix1 Owner');

    const path = 'src/eval/fix1-roundtrip.ts';
    const patch = makeDiffPatch(path);
    await pg.handle.db.insert(t.prFiles).values({ prId, path, additions: 1, deletions: 0, patch });
    const findingId = await insertDecidedFinding({
      prId,
      workspaceId,
      agentId: agent.id,
      file: path,
      decision: 'accepted',
    });

    const minted = await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    expect(minted.statusCode).toBe(201);
    const created = minted.json();
    expect(created.expected_output.findings[0]).toMatchObject({
      file: path,
      start_line: FIXTURE_LINE,
      end_line: FIXTURE_LINE,
      severity: 'CRITICAL',
    });

    // Round-trip the EXACT expected_output the mint step wrote — this is the
    // regression: the old skill-only schema would 200 with `file`/
    // `start_line`/`end_line` silently stripped from the stored value.
    const put = await app.inject({
      method: 'PUT',
      url: `/eval-cases/${created.id}`,
      payload: { expected_output: created.expected_output },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().expected_output.findings[0]).toMatchObject({
      file: path,
      start_line: FIXTURE_LINE,
      end_line: FIXTURE_LINE,
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded key',
    });

    await app.close();
  });

  it('PUT with a hand-authored agent-shaped expected_output (file/lines, no severity) succeeds, not 422', async () => {
    const app = await makeApp();
    const agent = await createAgent(app, 'Fix1 HandAuthored Owner');

    const created = await app.inject({
      method: 'POST',
      url: '/eval-cases',
      payload: {
        owner_kind: 'agent',
        owner_id: agent.id,
        name: 'hand-authored',
        input_diff: makeDiffPatch('src/eval/fix1-hand-authored.ts'),
        expected_output: { findings: [] },
      },
    });
    expect(created.statusCode).toBe(201);
    const caseId = created.json().id as string;

    const put = await app.inject({
      method: 'PUT',
      url: `/eval-cases/${caseId}`,
      payload: {
        expected_output: {
          findings: [
            { file: 'src/eval/fix1-hand-authored.ts', start_line: 1, end_line: 2 },
          ],
        },
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().expected_output.findings).toEqual([
      { file: 'src/eval/fix1-hand-authored.ts', start_line: 1, end_line: 2 },
    ]);

    await app.close();
  });

  it('PUT with an expected_output matching NEITHER shape still 422s', async () => {
    const app = await makeApp();
    const agent = await createAgent(app, 'Fix1 Garbage Owner');

    const created = await app.inject({
      method: 'POST',
      url: '/eval-cases',
      payload: {
        owner_kind: 'agent',
        owner_id: agent.id,
        name: 'garbage-patch',
        input_diff: makeDiffPatch('src/eval/fix1-garbage.ts'),
        expected_output: { findings: [] },
      },
    });
    expect(created.statusCode).toBe(201);
    const caseId = created.json().id as string;

    const put = await app.inject({
      method: 'PUT',
      url: `/eval-cases/${caseId}`,
      // Neither shape: no `file` (agent) and no `severity` (skill).
      payload: { expected_output: { findings: [{ title: 'not scoreable' }] } },
    });
    expect(put.statusCode).toBe(422);

    await app.close();
  });

  // ---- AC-11 — delete cascades its run history --------------------------

  it('deleting a case answers { ok: true }, removes its eval_runs, and drops it from the set (AC-11)', async () => {
    const app = await makeApp();
    const agent = await createAgent(app, 'AC11 Owner');

    const created = await app.inject({
      method: 'POST',
      url: '/eval-cases',
      payload: {
        owner_kind: 'agent',
        owner_id: agent.id,
        name: 'to-be-deleted',
        input_diff: makeDiffPatch('src/eval/ac11.ts'),
        expected_output: { findings: [{ file: 'src/eval/ac11.ts', start_line: FIXTURE_LINE, end_line: FIXTURE_LINE }] },
      },
    });
    expect(created.statusCode).toBe(201);
    const caseId = created.json().id as string;

    await pg.handle.db.insert(t.evalRuns).values({
      caseId,
      batchId: randomUUID(),
      agentVersion: agent.version,
      actualOutput: { findings: [], raw_count: 0, grounded_count: 0 },
      pass: true,
      recall: 1,
      precision: 1,
      citationAccuracy: 1,
      durationMs: 10,
      costUsd: 0.001,
    });

    const before = await pg.handle.db.select().from(t.evalRuns).where(eq(t.evalRuns.caseId, caseId));
    expect(before).toHaveLength(1);

    const deleted = await app.inject({ method: 'DELETE', url: `/eval-cases/${caseId}` });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ ok: true });

    const after = await pg.handle.db.select().from(t.evalRuns).where(eq(t.evalRuns.caseId, caseId));
    expect(after).toHaveLength(0);

    const list = (
      await app.inject({ method: 'GET', url: `/eval-cases?owner_kind=agent&owner_id=${agent.id}` })
    ).json() as { id: string }[];
    expect(list.map((c) => c.id)).not.toContain(caseId);

    await app.close();
  });

  // ---- AC-22 / AC-21 / AC-13 — the batch runner --------------------------

  it('runs a normal batch: batch_id + agent_version on every row, one model call per case, zero GitHub/git calls (AC-22, AC-21, AC-13)', async () => {
    const gitCalls: string[] = [];
    const githubCalls: string[] = [];
    const countingProxy = <T extends object>(target: T, calls: string[]): T =>
      new Proxy(target, {
        get(obj, prop, receiver) {
          const value = Reflect.get(obj, prop, receiver);
          if (typeof value === 'function') {
            return (...args: unknown[]) => {
              calls.push(String(prop));
              return (value as (...a: unknown[]) => unknown).apply(obj, args);
            };
          }
          return value;
        },
      });

    const path = 'src/eval/batch-target.ts';
    const llm = new MockLLMProvider('openai', {
      structured: {
        verdict: 'comment',
        summary: 'ok',
        score: 80,
        findings: [
          {
            id: 'f1',
            severity: 'WARNING',
            category: 'style',
            title: 'flag',
            file: path,
            start_line: FIXTURE_LINE,
            end_line: FIXTURE_LINE,
            rationale: 'r',
            confidence: 0.9,
          },
        ],
      },
    });

    const app = await makeApp(llm, {
      git: countingProxy(new MockGitClient(), gitCalls),
      github: countingProxy(new MockGitHubClient(), githubCalls),
    });
    const agent = await createAgent(app, 'AC22 Batch Owner');

    const names = ['case-a', 'case-b', 'case-c'];
    for (const name of names) {
      const res = await app.inject({
        method: 'POST',
        url: '/eval-cases',
        payload: {
          owner_kind: 'agent',
          owner_id: agent.id,
          name,
          input_diff: makeDiffPatch(path),
          expected_output: { findings: [{ file: path, start_line: FIXTURE_LINE, end_line: FIXTURE_LINE }] },
        },
      });
      expect(res.statusCode).toBe(201);
    }

    const run = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(run.statusCode).toBe(200);
    const batch = run.json() as AgentEvalBatch;
    expect(batch.cases).toHaveLength(3);
    expect(batch.traces_passed).toBe(3);
    expect(batch.traces_total).toBe(3);
    expect(batch.cases_errored).toBe(0);
    for (const c of batch.cases) {
      expect(c.pass).toBe(true);
      expect(c.recall).toBe(1);
      expect(c.precision).toBe(1);
    }

    // AC-21 / NFR cost: exactly one model call per case, no more.
    const structuredCalls = llm.calls.filter((c) => c.method === 'completeStructured');
    expect(structuredCalls).toHaveLength(3);

    // AC-13 / local-first: the runner never touches GitHub or a git clone.
    expect(gitCalls).toHaveLength(0);
    expect(githubCalls).toHaveLength(0);

    // AC-22: every persisted row of this batch shares one batch_id and the
    // agent's version at start time.
    const rows = await pg.handle.db
      .select()
      .from(t.evalRuns)
      .where(eq(t.evalRuns.batchId, batch.batch_id));
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.batchId).toBe(batch.batch_id);
      expect(row.agentVersion).toBe(agent.version);
    }

    await app.close();
  });

  it('refuses an empty case set WITHOUT calling the model (AC-23)', async () => {
    const llm = new MockLLMProvider('openai');
    const app = await makeApp(llm);
    const agent = await createAgent(app, 'AC23 Empty Owner');

    const run = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(run.statusCode).toBe(422);
    expect(llm.calls).toHaveLength(0);

    await app.close();
  });

  it('one failing case does not fail the batch: pass=null, error_reason set, metrics null, aggregates over the rest (AC-25)', async () => {
    const path = 'src/eval/ac25-target.ts';

    /** Throws on the SECOND completeStructured call (the middle case, by
     *  name order) — the rest succeed with a matching finding. */
    class PartiallyFailingLLM implements LLMProvider {
      readonly id: 'openai' | 'anthropic' | 'openrouter' = 'openai';
      calls: unknown[] = [];
      async listModels() {
        return [];
      }
      async complete(): Promise<never> {
        throw new Error('complete() not expected in an eval run');
      }
      async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
        const index = this.calls.length;
        this.calls.push(req);
        if (index === 1) throw new Error('mock provider failure');
        const fixture = {
          verdict: 'comment',
          summary: 'ok',
          score: 80,
          findings: [
            {
              id: 'f1',
              severity: 'WARNING',
              category: 'style',
              title: 'flag',
              file: path,
              start_line: FIXTURE_LINE,
              end_line: FIXTURE_LINE,
              rationale: 'r',
              confidence: 0.9,
            },
          ],
        };
        const parsed = req.schema.safeParse(fixture);
        if (!parsed.success) throw new Error(`fixture failed schema: ${parsed.error.message}`);
        return {
          data: parsed.data,
          model: req.model,
          tokensIn: 10,
          tokensOut: 5,
          costUsd: 0.0001,
          raw: JSON.stringify(fixture),
          attempts: 1,
        };
      }
      async embed(texts: string[]): Promise<number[][]> {
        return texts.map(() => []);
      }
    }

    const llm = new PartiallyFailingLLM();
    const app = await makeApp(llm);
    const agent = await createAgent(app, 'AC25 Owner');

    const names = ['case-a-pass', 'case-b-fail', 'case-c-pass'];
    for (const name of names) {
      const res = await app.inject({
        method: 'POST',
        url: '/eval-cases',
        payload: {
          owner_kind: 'agent',
          owner_id: agent.id,
          name,
          input_diff: makeDiffPatch(path),
          expected_output: { findings: [{ file: path, start_line: FIXTURE_LINE, end_line: FIXTURE_LINE }] },
        },
      });
      expect(res.statusCode).toBe(201);
    }

    const run = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(run.statusCode).toBe(200);
    const batch = run.json() as AgentEvalBatch;
    expect(batch.cases).toHaveLength(3);
    expect(batch.cases_errored).toBe(1);
    expect(batch.traces_total).toBe(2);
    expect(batch.traces_passed).toBe(2);

    const failed = batch.cases.find((c) => c.case_name === 'case-b-fail')!;
    expect(failed.pass).toBeNull();
    expect(failed.error).not.toBeNull();
    const passed = batch.cases.filter((c) => c.case_name !== 'case-b-fail');
    for (const c of passed) {
      expect(c.pass).toBe(true);
    }

    const failedRow = (
      await pg.handle.db.select().from(t.evalRuns).where(eq(t.evalRuns.id, failed.run_id))
    )[0]!;
    expect(failedRow.pass).toBeNull();
    expect(failedRow.errorReason).toBeTruthy();
    expect(failedRow.recall).toBeNull();
    expect(failedRow.precision).toBeNull();
    expect(failedRow.citationAccuracy).toBeNull();

    await app.close();
  });

  // ---- fix pass, item 3 — last_batch is NOT capped by the global window --

  it(
    "an agent's last_batch survives being pushed out of the global " +
      'recent_batches window (fix pass, item 3)',
    async () => {
      const llm = new MockLLMProvider('openai', {
        structured: { verdict: 'comment', summary: 'ok', score: 90, findings: [] },
      });
      const app = await makeApp(llm);

      const target = await createAgent(app, 'Fix3 Target Owner');
      const targetCase = await app.inject({
        method: 'POST',
        url: '/eval-cases',
        payload: {
          owner_kind: 'agent',
          owner_id: target.id,
          name: 'target-case',
          input_diff: makeDiffPatch('src/eval/fix3-target.ts'),
          expected_output: { findings: [] },
        },
      });
      expect(targetCase.statusCode).toBe(201);
      const targetRun = await app.inject({ method: 'POST', url: `/agents/${target.id}/eval-runs` });
      expect(targetRun.statusCode).toBe(200);
      const targetBatchId = (targetRun.json() as AgentEvalBatch).batch_id;

      // Push the target's batch out of the global top-BATCH_TABLE_LIMIT (20)
      // window with 20 strictly later batches from a SECOND agent.
      const other = await createAgent(app, 'Fix3 Other Owner');
      const otherCase = await app.inject({
        method: 'POST',
        url: '/eval-cases',
        payload: {
          owner_kind: 'agent',
          owner_id: other.id,
          name: 'other-case',
          input_diff: makeDiffPatch('src/eval/fix3-other.ts'),
          expected_output: { findings: [] },
        },
      });
      expect(otherCase.statusCode).toBe(201);
      for (let i = 0; i < 20; i++) {
        const run = await app.inject({ method: 'POST', url: `/agents/${other.id}/eval-runs` });
        expect(run.statusCode).toBe(200);
      }

      const overview = (
        await app.inject({ method: 'GET', url: '/eval/overview' })
      ).json() as EvalDashboardOverview;

      // 21 total batches, global table capped at 20 — the target's (oldest)
      // batch is gone from the shared table…
      expect(overview.recent_batches.some((b) => b.batch_id === targetBatchId)).toBe(false);

      // …but `last_batch` on the target's own summary must still report it,
      // not `null` (the bug: it used to be derived from the same capped
      // `recent_batches` read above).
      const targetSummary = overview.agents.find((a) => a.agent_id === target.id);
      expect(targetSummary).toBeDefined();
      expect(targetSummary!.last_batch).not.toBeNull();
      expect(targetSummary!.last_batch!.batch_id).toBe(targetBatchId);

      await app.close();
    },
    30_000,
  );

  // ---- fix pass, item 6 — regression alert fires on the EXACT threshold --

  it(
    'a regression alert fires on the EXACT 2.0pp threshold, not only a drop strictly greater ' +
      'than it (fix pass, item 6: >= REGRESSION_THRESHOLD_PP, not >)',
    async () => {
      const app = await makeApp();
      const agent = await createAgent(app, 'Fix6 Boundary Owner');

      const created = await app.inject({
        method: 'POST',
        url: '/eval-cases',
        payload: {
          owner_kind: 'agent',
          owner_id: agent.id,
          name: 'boundary-case',
          input_diff: makeDiffPatch('src/eval/fix6-boundary.ts'),
          expected_output: { findings: [{ file: 'src/eval/fix6-boundary.ts', start_line: 1, end_line: 1 }] },
        },
      });
      expect(created.statusCode).toBe(201);
      const caseId = created.json().id as string;

      // Two synthetic, already-scored `eval_runs` rows (bypassing the model,
      // like the AC-11 test above) — recall drops from 1.0 to 0.98, EXACTLY
      // REGRESSION_THRESHOLD_PP (2) percentage points.
      await pg.handle.db.insert(t.evalRuns).values([
        {
          caseId,
          batchId: randomUUID(),
          agentVersion: agent.version,
          ranAt: new Date('2026-01-01T00:00:00.000Z'),
          actualOutput: { findings: [], raw_count: 1, grounded_count: 1 },
          pass: true,
          recall: 1,
          precision: 1,
          citationAccuracy: 1,
          durationMs: 10,
          costUsd: 0.001,
        },
        {
          caseId,
          batchId: randomUUID(),
          agentVersion: agent.version,
          ranAt: new Date('2026-01-02T00:00:00.000Z'),
          actualOutput: { findings: [], raw_count: 1, grounded_count: 1 },
          pass: false,
          recall: 0.98,
          precision: 1,
          citationAccuracy: 1,
          durationMs: 10,
          costUsd: 0.001,
        },
      ]);

      const dashboard = (
        await app.inject({ method: 'GET', url: `/eval/dashboard?owner_id=${agent.id}` })
      ).json() as EvalDashboard;

      expect(dashboard.alert).not.toBeNull();
      expect(dashboard.alert?.metric).toBe('recall');
      expect(dashboard.alert?.drop_pp).toBe(2);

      await app.close();
    },
  );

  // ---- review loop 2 — a batch that MEASURED NOTHING is not a data point --

  it(
    'a batch where every case errored produces no delta and no trend point — its 0-placeholder ' +
      'metrics never render as a recovery or a collapse (review loop 2)',
    async () => {
      const app = await makeApp();
      const agent = await createAgent(app, 'Errored Batch Owner');

      const created = await app.inject({
        method: 'POST',
        url: '/eval-cases',
        payload: {
          owner_kind: 'agent',
          owner_id: agent.id,
          name: 'errored-batch-case',
          input_diff: makeDiffPatch('src/eval/loop2-errored.ts'),
          expected_output: { findings: [{ file: 'src/eval/loop2-errored.ts', start_line: 1, end_line: 1 }] },
        },
      });
      expect(created.statusCode).toBe(201);
      const caseId = created.json().id as string;

      // Batch 1 measured (recall 0.9). Batch 2 is the dead-provider batch:
      // `pass = null`, every metric null — so it aggregates to traces_total 0
      // and the schema-legal `0` placeholder for recall/precision.
      await pg.handle.db.insert(t.evalRuns).values([
        {
          caseId,
          batchId: randomUUID(),
          agentVersion: agent.version,
          ranAt: new Date('2026-02-01T00:00:00.000Z'),
          actualOutput: { findings: [], raw_count: 1, grounded_count: 1 },
          pass: true,
          recall: 0.9,
          precision: 0.9,
          citationAccuracy: 0.9,
          durationMs: 10,
          costUsd: 0.001,
        },
        {
          caseId,
          batchId: randomUUID(),
          agentVersion: agent.version,
          ranAt: new Date('2026-02-02T00:00:00.000Z'),
          actualOutput: { error: { code: 'provider_error', message: 'no key' } },
          errorReason: 'provider_error',
          pass: null,
          recall: null,
          precision: null,
          citationAccuracy: null,
          durationMs: 10,
          costUsd: null,
        },
      ]);

      const dashboard = (
        await app.inject({ method: 'GET', url: `/eval/dashboard?owner_id=${agent.id}` })
      ).json() as EvalDashboard;

      // Both batches are still LISTED — the table is where "this run failed"
      // belongs, and `cases_errored` carries the reason.
      expect(dashboard.recent_batches).toHaveLength(2);
      expect(dashboard.recent_batches[0]!.traces_total).toBe(0);
      expect(dashboard.recent_batches[0]!.cases_errored).toBe(1);

      // But it is not diffed against, and it is not plotted.
      expect(dashboard.delta).toBeNull();
      expect(dashboard.trend).toHaveLength(1);
      expect(dashboard.trend[0]!.recall).toBe(0.9);

      // And it cannot fire a regression banner either (fix pass, item 2a).
      expect(dashboard.alert).toBeNull();

      await app.close();
    },
  );

  // ---- AC-28 — skill-owned cases never appear in the Eval Dashboard -----

  it('a seeded skill-owned eval case never appears in GET /eval/overview (AC-28)', async () => {
    const app = await makeApp();
    const { db } = pg.handle;

    const [rubric] = await db.select().from(t.skills).where(eq(t.skills.name, 'pr-quality-rubric'));
    expect(rubric).toBeDefined();
    const skillCases = (
      await app.inject({ method: 'GET', url: `/skills/${rubric!.id}/eval-cases` })
    ).json() as { name: string }[];
    expect(skillCases.map((c) => c.name)).toContain('stripe-key-leak');

    const overview = (
      await app.inject({ method: 'GET', url: '/eval/overview' })
    ).json() as EvalDashboardOverview;
    expect(overview.agents.some((a) => a.agent_id === rubric!.id)).toBe(false);
    for (const b of overview.recent_batches) {
      expect(b.agent_id).not.toBe(rubric!.id);
    }

    await app.close();
  });

  // ---- Design-fidelity plan, step 9 — GET /eval/overview's per-agent trend
  // (AC-40, AC-41): the seam nobody on either side of it could test alone
  // (INSIGHTS root#2026-08-04) — step 5 (repository.ts/dashboard.ts) and
  // step 8 (the client row/table) each unit-test their own half against a
  // mock of the other; only the LIVE route proves the real one.

  it(
    'GET /eval/overview returns a real, chronological (oldest first) per-agent trend — never the ' +
      'step-1 [] placeholder — capped at BATCH_TABLE_LIMIT even with more batches than that (AC-40, AC-41)',
    async () => {
      const app = await makeApp();
      const agent = await createAgent(app, 'Trend Cap Owner');

      const created = await app.inject({
        method: 'POST',
        url: '/eval-cases',
        payload: {
          owner_kind: 'agent',
          owner_id: agent.id,
          name: 'trend-cap-case',
          input_diff: makeDiffPatch('src/eval/trend-cap.ts'),
          expected_output: { findings: [{ file: 'src/eval/trend-cap.ts', start_line: 1, end_line: 1 }] },
        },
      });
      expect(created.statusCode).toBe(201);
      const caseId = created.json().id as string;

      // BATCH_TABLE_LIMIT (20) + 5 = 25 measured batches, strictly ascending
      // ran_at, one case-row per batch (a batch is a shared batch_id, not a
      // row count, so one row is still a valid, distinct batch).
      const totalBatches = BATCH_TABLE_LIMIT + 5;
      const rows = Array.from({ length: totalBatches }, (_, i) => ({
        caseId,
        batchId: randomUUID(),
        agentVersion: agent.version,
        ranAt: new Date(Date.UTC(2026, 0, 1 + i)),
        actualOutput: { findings: [], raw_count: 1, grounded_count: 1 },
        pass: true,
        recall: Math.round((i / (totalBatches - 1)) * 100) / 100,
        precision: 0.9,
        citationAccuracy: 0.9,
        durationMs: 10,
        costUsd: 0.001,
      }));
      await pg.handle.db.insert(t.evalRuns).values(rows);

      const overview = (
        await app.inject({ method: 'GET', url: '/eval/overview' })
      ).json() as EvalDashboardOverview;
      const summary = overview.agents.find((a) => a.agent_id === agent.id);
      expect(summary).toBeDefined();

      // Never the [] placeholder for an agent with real measured batches.
      expect(summary!.trend.length).toBeGreaterThan(0);
      // Capped at BATCH_TABLE_LIMIT even though 25 batches were run.
      expect(summary!.trend).toHaveLength(BATCH_TABLE_LIMIT);

      // Chronological, oldest first — the opposite of every table in this
      // feature. Only the newest BATCH_TABLE_LIMIT of the 25 survive the
      // per-agent cap, so trend[0] is the (totalBatches - BATCH_TABLE_LIMIT)-th
      // inserted batch, not the very first ever recorded.
      const ranAts = summary!.trend.map((p) => new Date(p.ran_at).getTime());
      for (let i = 1; i < ranAts.length; i++) {
        expect(ranAts[i]).toBeGreaterThan(ranAts[i - 1]!);
      }
      expect(summary!.trend[0]!.ran_at).toBe(rows[totalBatches - BATCH_TABLE_LIMIT]!.ranAt.toISOString());
      expect(summary!.trend[summary!.trend.length - 1]!.ran_at).toBe(
        rows[totalBatches - 1]!.ranAt.toISOString(),
      );

      // last_batch equals the newest trend batch — the two can no longer
      // disagree because both are derived from the same per-agent read (step 5).
      expect(summary!.last_batch).not.toBeNull();
      expect(summary!.last_batch!.ran_at).toBe(summary!.trend[summary!.trend.length - 1]!.ran_at);

      await app.close();
    },
    30_000,
  );

  it(
    'excludes batches with traces_total = 0 from trend, while last_batch stays the newest batch ' +
      'REGARDLESS of whether it was measured (per-variant rule, Contract & migration impact)',
    async () => {
      const app = await makeApp();
      const agent = await createAgent(app, 'Unmeasured Trend Owner');

      const created = await app.inject({
        method: 'POST',
        url: '/eval-cases',
        payload: {
          owner_kind: 'agent',
          owner_id: agent.id,
          name: 'unmeasured-case',
          input_diff: makeDiffPatch('src/eval/unmeasured.ts'),
          expected_output: { findings: [{ file: 'src/eval/unmeasured.ts', start_line: 1, end_line: 1 }] },
        },
      });
      expect(created.statusCode).toBe(201);
      const caseId = created.json().id as string;

      // The agent's ONLY batch so far measured nothing (every case in it errored).
      const erroredBatchId = randomUUID();
      await pg.handle.db.insert(t.evalRuns).values({
        caseId,
        batchId: erroredBatchId,
        agentVersion: agent.version,
        ranAt: new Date('2026-03-01T00:00:00.000Z'),
        actualOutput: { error: { code: 'provider_error', message: 'no key' } },
        errorReason: 'provider_error',
        pass: null,
        recall: null,
        precision: null,
        citationAccuracy: null,
        durationMs: 10,
        costUsd: null,
      });

      const first = (
        await app.inject({ method: 'GET', url: '/eval/overview' })
      ).json() as EvalDashboardOverview;
      const firstSummary = first.agents.find((a) => a.agent_id === agent.id);
      expect(firstSummary).toBeDefined();

      // Per-variant rule: a NON-NULL last_batch and an EMPTY trend are BOTH
      // legal at once. `last_batch === null` is the sole "never run"
      // discriminant — never `trend.length === 0`.
      expect(firstSummary!.last_batch).not.toBeNull();
      expect(firstSummary!.last_batch!.batch_id).toBe(erroredBatchId);
      expect(firstSummary!.last_batch!.traces_total).toBe(0);
      expect(firstSummary!.trend).toEqual([]);

      // Now add an OLDER, measured batch.
      const measuredBatchId = randomUUID();
      await pg.handle.db.insert(t.evalRuns).values({
        caseId,
        batchId: measuredBatchId,
        agentVersion: agent.version,
        ranAt: new Date('2026-02-01T00:00:00.000Z'),
        actualOutput: { findings: [], raw_count: 1, grounded_count: 1 },
        pass: true,
        recall: 0.75,
        precision: 0.8,
        citationAccuracy: 0.7,
        durationMs: 10,
        costUsd: 0.001,
      });

      const second = (
        await app.inject({ method: 'GET', url: '/eval/overview' })
      ).json() as EvalDashboardOverview;
      const secondSummary = second.agents.find((a) => a.agent_id === agent.id);
      expect(secondSummary).toBeDefined();

      // The errored batch is still the newest overall and stays last_batch —
      // it is NOT derived from trend — but it is excluded from trend,
      // leaving only the older, measured batch as the sole point.
      expect(secondSummary!.last_batch!.batch_id).toBe(erroredBatchId);
      expect(secondSummary!.trend).toHaveLength(1);
      expect(secondSummary!.trend[0]!.recall).toBe(0.75);

      await app.close();
    },
  );

  it('yields exactly one trend point for an agent with exactly one (measured) batch', async () => {
    const llm = new MockLLMProvider('openai', {
      structured: { verdict: 'comment', summary: 'ok', score: 90, findings: [] },
    });
    const app = await makeApp(llm);
    const agent = await createAgent(app, 'Single Batch Owner');

    const created = await app.inject({
      method: 'POST',
      url: '/eval-cases',
      payload: {
        owner_kind: 'agent',
        owner_id: agent.id,
        name: 'single-batch-case',
        input_diff: makeDiffPatch('src/eval/single-batch.ts'),
        expected_output: { findings: [] },
      },
    });
    expect(created.statusCode).toBe(201);

    const run = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(run.statusCode).toBe(200);
    const batch = run.json() as AgentEvalBatch;
    expect(batch.traces_total).toBeGreaterThan(0);

    const overview = (
      await app.inject({ method: 'GET', url: '/eval/overview' })
    ).json() as EvalDashboardOverview;
    const summary = overview.agents.find((a) => a.agent_id === agent.id);
    expect(summary).toBeDefined();
    expect(summary!.trend).toHaveLength(1);
    expect(summary!.last_batch).not.toBeNull();
    expect(summary!.last_batch!.batch_id).toBe(batch.batch_id);
    expect(summary!.trend[0]!.ran_at).toBe(summary!.last_batch!.ran_at);

    await app.close();
  });

  // ---- AC-34 (backend half) — missing version snapshot -------------------

  it('GET /agents/:id/versions/:version 404s for a snapshot that was never recorded (AC-34)', async () => {
    const app = await makeApp();
    const agent = await createAgent(app, 'AC34 Owner');

    const res = await app.inject({ method: 'GET', url: `/agents/${agent.id}/versions/42` });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  // ---- Cross-lane seam checks ---------------------------------------------

  it(
    'the Run all agents fan-out hook (client/src/lib/hooks/eval.ts#useRunAllAgentEvalBatches) posts ' +
      'to the SAME route routes.ts registers — no undocumented second endpoint (design-fidelity plan, step 9)',
    async () => {
      const app = await makeApp();
      // The fan-out hook reuses `useRunAgentEvalBatch`'s own endpoint
      // (`api.post(\`/agents/${agentId}/eval-runs\`)`, one call per agent)
      // rather than a new server route — plan: "Mechanism for `Run all
      // agents`" decision. This pins that the route it targets is the one
      // this module actually registers, not a route the plan only intended.
      expect(app.hasRoute({ method: 'POST', url: '/agents/:id/eval-runs' })).toBe(true);
      await app.close();
    },
  );

  it('every route the client hooks call exists with the method+path they use, and bodies parse against the shared contracts', async () => {
    const app = await makeApp();

    // hooks/eval.ts — GET/POST /eval-cases, GET/PUT/DELETE /eval-cases/:id,
    // POST /findings/:id/eval-case, POST /agents/:id/eval-runs,
    // GET /eval/overview, GET /eval/dashboard.
    expect(app.hasRoute({ method: 'GET', url: '/eval-cases' })).toBe(true);
    expect(app.hasRoute({ method: 'POST', url: '/eval-cases' })).toBe(true);
    expect(app.hasRoute({ method: 'GET', url: '/eval-cases/:id' })).toBe(true);
    expect(app.hasRoute({ method: 'PUT', url: '/eval-cases/:id' })).toBe(true);
    expect(app.hasRoute({ method: 'DELETE', url: '/eval-cases/:id' })).toBe(true);
    expect(app.hasRoute({ method: 'POST', url: '/findings/:id/eval-case' })).toBe(true);
    expect(app.hasRoute({ method: 'POST', url: '/agents/:id/eval-runs' })).toBe(true);
    expect(app.hasRoute({ method: 'GET', url: '/eval/overview' })).toBe(true);
    expect(app.hasRoute({ method: 'GET', url: '/eval/dashboard' })).toBe(true);
    // hooks/eval.ts's compare-modal read (existing agents route, not new).
    expect(app.hasRoute({ method: 'GET', url: '/agents/:id/versions/:version' })).toBe(true);

    // The form step 7 writes is the form step 3 (the scorer) reads, and the
    // form step 9 emits is the form step 13 renders — checked here by parsing
    // real responses against the shared Zod contracts (crossing the wire is
    // what actually proves the shapes, not re-reading the source).
    const agent = await createAgent(app, 'Seam Owner');
    const created = await app.inject({
      method: 'POST',
      url: '/eval-cases',
      payload: {
        owner_kind: 'agent',
        owner_id: agent.id,
        name: 'seam-case',
        input_diff: makeDiffPatch('src/eval/seam.ts'),
        expected_output: { findings: [{ file: 'src/eval/seam.ts', start_line: 1, end_line: 1 }] },
      },
    });
    expect(() => EvalCase.parse(created.json())).not.toThrow();

    const overview = await app.inject({ method: 'GET', url: '/eval/overview' });
    expect(() => EvalDashboardOverview.parse(overview.json())).not.toThrow();

    const dashboard = await app.inject({ method: 'GET', url: `/eval/dashboard?owner_id=${agent.id}` });
    expect(() => EvalDashboard.parse(dashboard.json())).not.toThrow();

    // A real batch run's body parses as AgentEvalBatch (also exercised, with
    // fuller assertions, by the AC-22 test above).
    const llm = new MockLLMProvider('openai', {
      structured: { verdict: 'comment', summary: 'ok', score: 90, findings: [] },
    });
    const app2 = await makeApp(llm);
    const agent2 = await createAgent(app2, 'Seam Batch Owner');
    await app2.inject({
      method: 'POST',
      url: '/eval-cases',
      payload: {
        owner_kind: 'agent',
        owner_id: agent2.id,
        name: 'seam-batch-case',
        input_diff: makeDiffPatch('src/eval/seam-batch.ts'),
        expected_output: { findings: [] },
      },
    });
    const run = await app2.inject({ method: 'POST', url: `/agents/${agent2.id}/eval-runs` });
    expect(() => AgentEvalBatch.parse(run.json())).not.toThrow();

    await app.close();
    await app2.close();
  });
});
