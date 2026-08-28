import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider, MockSecretsProvider } from '../src/adapters/mocks.js';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';
import { AgentEvalBatch, EvalCase, EvalDashboard, EvalDashboardOverview } from '@devdigest/shared';
import type {
  EvalRunRecord,
  GitClient,
  GitHubClient,
  LLMProvider,
  SecretsProvider,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';
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

/**
 * expectation-kind plan (l06-evals-expectation-kind), step 11 — the two
 * `@devdigest/shared` copies of `EvalCase`/`ExpectationKind` moved in ONE step
 * (step 1), but `AGENTS.md` calls the client copy "trimmed" and "already
 * drifted" on purpose: its doc comments are shorter than the server's. A
 * byte-for-byte block comparison (the pattern the EvalAgentSummary check above
 * uses) would therefore fail on prose that is SUPPOSED to differ. This strips
 * every full-line `//` comment before comparing, so what is actually pinned is
 * the zod SHAPE — field names, order and types — never the commentary around
 * it. Runs regardless of Docker availability; it needs no live database.
 */
describe('eval-cases contract — EvalCase/ExpectationKind mirror (no DB required)', () => {
  it('the client copy of EvalCase (and ExpectationKind) matches the server copy FIELD-FOR-FIELD (AC-53)', () => {
    const extractBlock = (src: string): string => {
      const match = src.match(
        /export const ExpectationKind = z\.enum[\s\S]*?export type EvalCase = z\.infer<typeof EvalCase>;/,
      );
      if (!match) throw new Error('EvalCase/ExpectationKind block marker not found');
      return match[0];
    };
    const stripComments = (block: string): string =>
      block
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('//'))
        .join('\n');

    const testDir = dirname(fileURLToPath(import.meta.url));
    const serverSrc = readFileSync(resolve(testDir, '../src/vendor/shared/contracts/knowledge.ts'), 'utf8');
    const clientSrc = readFileSync(
      resolve(testDir, '../../client/src/vendor/shared/contracts/knowledge.ts'),
      'utf8',
    );
    expect(stripComments(extractBlock(clientSrc))).toBe(stripComments(extractBlock(serverSrc)));
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

  function makeApp(
    llmOverride?: LLMProvider,
    extra?: { git?: GitClient; github?: GitHubClient; secrets?: SecretsProvider },
  ) {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: extra?.git ?? new MockGitClient(),
        github: extra?.github ?? new MockGitHubClient(),
        // Step 11's 409-before-any-DB-write test needs a secrets provider that
        // answers every key with `undefined` — an empty `MockSecretsProvider`
        // — rather than falling through to whatever real key this machine's
        // `~/.devdigest/secrets.json` happens to have.
        ...(extra?.secrets ? { secrets: extra.secrets } : {}),
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

  /** What GitHub actually stores in `pr_files.patch`: hunks only, NO file
   *  header. This is the shape that made agent eval scoring inert — a
   *  headerless diff parses to zero files, so the grounding gate drops every
   *  finding as uncited. Kept separate from `makeDiffPatch` so the two shapes
   *  cannot drift: the old fixture was fully headered, which is exactly why
   *  the suite never caught the bug. */
  function makeGithubPatch(): string {
    return [
      '@@ -10,3 +10,4 @@',
      ' export const config = {',
      '   value: 1,',
      '+  flag: true,',
      ' };',
    ].join('\n');
  }

  /** A minimal, realistic unified-diff patch for `path` — one added line at
   *  new-side line 12 (matches the grounding-gate fixture pattern already
   *  proven in `skills-eval.test.ts`). Headered, i.e. what a case looks like
   *  AFTER `ensureDiffFileHeader`. */
  function makeDiffPatch(path: string): string {
    return [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      makeGithubPatch(),
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

    // expectation-kind plan, step 11 — the kind comes from the DECISION
    // (accepted), on the wire (AC-3) AND on the stored row (AC-53).
    expect(created.expectation_kind).toBe('must_find');
    const [row] = await pg.handle.db.select().from(t.evalCases).where(eq(t.evalCases.id, created.id));
    expect(row!.expectationKind).toBe('must_find');

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

    // expectation-kind plan, step 11 — the kind comes from the DECISION
    // (dismissed), on the wire (AC-4) AND on the stored row (AC-53).
    expect(created.expectation_kind).toBe('must_not_flag');
    const [row] = await pg.handle.db.select().from(t.evalCases).where(eq(t.evalCases.id, created.id));
    expect(row!.expectationKind).toBe('must_not_flag');

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

  // ---- expectation-kind plan, step 11 — AC-54: derived ONCE at creation ---

  it(
    'POST /eval-cases derives expectation_kind ONCE from expected_output: non-empty findings -> must_find, ' +
      'empty findings -> must_not_flag, and a MALFORMED findings entry (missing file/start_line/end_line, ' +
      'unscoreable by the same expectedFindings() the scorer reads) also -> must_not_flag (AC-54)',
    async () => {
      const app = await makeApp();
      const agent = await createAgent(app, 'AC54 Owner');

      const withFindings = await app.inject({
        method: 'POST',
        url: '/eval-cases',
        payload: {
          owner_kind: 'agent',
          owner_id: agent.id,
          name: 'ac54-with-findings',
          input_diff: makeDiffPatch('src/eval/ac54-a.ts'),
          expected_output: { findings: [{ file: 'src/eval/ac54-a.ts', start_line: 1, end_line: 1 }] },
        },
      });
      expect(withFindings.statusCode).toBe(201);
      expect(withFindings.json().expectation_kind).toBe('must_find');

      const withoutFindings = await app.inject({
        method: 'POST',
        url: '/eval-cases',
        payload: {
          owner_kind: 'agent',
          owner_id: agent.id,
          name: 'ac54-without-findings',
          input_diff: makeDiffPatch('src/eval/ac54-b.ts'),
          expected_output: { findings: [] },
        },
      });
      expect(withoutFindings.statusCode).toBe(201);
      expect(withoutFindings.json().expectation_kind).toBe('must_not_flag');

      // Malformed: an entry with neither `file` nor `start_line`/`end_line` —
      // `expectedFindings()` (`eval/helpers.ts`) safeParse-fails the whole
      // array and returns `[]`, so this counts as "expected nothing" the same
      // way an explicitly empty array does.
      const malformed = await app.inject({
        method: 'POST',
        url: '/eval-cases',
        payload: {
          owner_kind: 'agent',
          owner_id: agent.id,
          name: 'ac54-malformed',
          input_diff: makeDiffPatch('src/eval/ac54-c.ts'),
          expected_output: { findings: [{ title: 'not scoreable' }] },
        },
      });
      expect(malformed.statusCode).toBe(201);
      expect(malformed.json().expectation_kind).toBe('must_not_flag');

      await app.close();
    },
  );

  // ---- expectation-kind plan, step 11 — AC-55: immutable on update --------

  it(
    'PUT /eval-cases/:id that rewrites expected_output to [] leaves expectation_kind UNCHANGED in the PUT ' +
      'response AND on a subsequent GET, and a PUT carrying expectation_kind is REJECTED (422), never silently ' +
      'applied (AC-55)',
    async () => {
      const app = await makeApp();
      const agent = await createAgent(app, 'AC55 Owner');
      const path = 'src/eval/ac55.ts';

      const created = await app.inject({
        method: 'POST',
        url: '/eval-cases',
        payload: {
          owner_kind: 'agent',
          owner_id: agent.id,
          name: 'ac55-case',
          input_diff: makeDiffPatch(path),
          expected_output: { findings: [{ file: path, start_line: 1, end_line: 1 }] },
        },
      });
      expect(created.statusCode).toBe(201);
      const caseId = created.json().id as string;
      expect(created.json().expectation_kind).toBe('must_find');

      // Rewrite expected_output to `[]` — the case now has ZERO expectations,
      // which is the exact mismatch edge case (AC-58), but the stored kind
      // must survive the edit untouched (AC-55).
      const put = await app.inject({
        method: 'PUT',
        url: `/eval-cases/${caseId}`,
        payload: { expected_output: { findings: [] } },
      });
      expect(put.statusCode).toBe(200);
      expect(put.json().expected_output.findings).toEqual([]);
      expect(put.json().expectation_kind).toBe('must_find');

      const get = await app.inject({ method: 'GET', url: `/eval-cases/${caseId}` });
      expect(get.statusCode).toBe(200);
      expect(get.json().expectation_kind).toBe('must_find');

      // A PUT body carrying expectation_kind is rejected outright — the
      // shared route's `.strict()` body has no such key, so an unrecognised
      // key 422s rather than being stripped-and-ignored (Open questions:
      // "a PUT body carrying expectation_kind 422s rather than being
      // silently ignored").
      const putWithKind = await app.inject({
        method: 'PUT',
        url: `/eval-cases/${caseId}`,
        payload: { expectation_kind: 'must_not_flag' },
      });
      expect(putWithKind.statusCode).toBe(422);

      // And the row is untouched by the rejected attempt.
      const getAfterRejected = await app.inject({ method: 'GET', url: `/eval-cases/${caseId}` });
      expect(getAfterRejected.json().expectation_kind).toBe('must_find');

      await app.close();
    },
  );

  // ---- expectation-kind plan, step 11 — AC-56: backfill for legacy rows ---

  it(
    'a row inserted with NO stored kind (the shape a case created before migration 0019 added the column ' +
      'would have) is typed correctly by re-running that SAME migration\'s backfill rule, while a skill-owned ' +
      'row (the seeded stripe-key-leak case) stays NULL — the backfill only ever touches owner_kind = \'agent\' ' +
      '(AC-56)',
    async () => {
      const app = await makeApp();
      const { db, sql } = pg.handle;
      const workspaceId = await defaultWorkspaceId();
      const agent = await createAgent(app, 'AC56 Owner');

      // Insert directly (bypassing the service, which always sets a kind at
      // creation) — this is the pre-migration-0019 shape: the column exists
      // (it must, in this fixture) but nothing has EVER written to it.
      const [withFindings] = await db
        .insert(t.evalCases)
        .values({
          workspaceId,
          ownerKind: 'agent',
          ownerId: agent.id,
          name: 'ac56-legacy-with-findings',
          inputDiff: makeDiffPatch('src/eval/ac56-a.ts'),
          expectedOutput: { findings: [{ file: 'src/eval/ac56-a.ts', start_line: 1, end_line: 1 }] },
        })
        .returning();
      const [withoutFindings] = await db
        .insert(t.evalCases)
        .values({
          workspaceId,
          ownerKind: 'agent',
          ownerId: agent.id,
          name: 'ac56-legacy-without-findings',
          inputDiff: makeDiffPatch('src/eval/ac56-b.ts'),
          expectedOutput: { findings: [] },
        })
        .returning();
      expect(withFindings!.expectationKind).toBeNull();
      expect(withoutFindings!.expectationKind).toBeNull();

      // Re-run EXACTLY the backfill statement migration 0019 ships
      // (`server/src/db/migrations/0019_youthful_giant_man.sql`) — this
      // fixture's Postgres container already ran every migration, including
      // 0019, before any row existed (`test/helpers/pg.ts`), so the only way
      // to exercise "a row that predates the column" is to simulate one and
      // apply the SAME rule `pnpm db:migrate` would have applied to it.
      await sql`
        UPDATE "eval_cases" SET "expectation_kind" = CASE
          WHEN jsonb_typeof("expected_output"->'findings') = 'array'
           AND jsonb_array_length("expected_output"->'findings') > 0
          THEN 'must_find' ELSE 'must_not_flag'
        END WHERE "owner_kind" = 'agent' AND "expectation_kind" IS NULL;
      `;

      const [refetchedWith] = await db.select().from(t.evalCases).where(eq(t.evalCases.id, withFindings!.id));
      const [refetchedWithout] = await db
        .select()
        .from(t.evalCases)
        .where(eq(t.evalCases.id, withoutFindings!.id));
      expect(refetchedWith!.expectationKind).toBe('must_find');
      expect(refetchedWithout!.expectationKind).toBe('must_not_flag');

      // And typed on the wire, too.
      const get = await app.inject({ method: 'GET', url: `/eval-cases/${withFindings!.id}` });
      expect(get.json().expectation_kind).toBe('must_find');

      // The seeded SKILL-owned case (`stripe-key-leak`, `src/db/seed.ts`) was
      // inserted the exact same way — no kind ever written — and the
      // backfill's `WHERE owner_kind = 'agent'` clause must never touch it.
      const [rubric] = await db.select().from(t.skills).where(eq(t.skills.name, 'pr-quality-rubric'));
      const [skillCase] = await db
        .select()
        .from(t.evalCases)
        .where(and(eq(t.evalCases.ownerId, rubric!.id), eq(t.evalCases.name, 'stripe-key-leak')));
      expect(skillCase!.expectationKind).toBeNull();

      await app.close();
    },
  );

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

  // ---- expectation-kind plan, step 11 — AC-57: scoring reads ONLY the -----
  // ---- expected_output, never the stored kind, even when they contradict --

  it(
    'scoring reads ONLY expected_output, never the stored expectation_kind — a case whose stored kind ' +
      'CONTRADICTS its expectations still scores by the expectations (AC-57)',
    async () => {
      const llm = new MockLLMProvider('openai', {
        structured: { verdict: 'comment', summary: 'ok', score: 90, findings: [] },
      });
      const app = await makeApp(llm);
      const agent = await createAgent(app, 'AC57 Owner');
      const path = 'src/eval/ac57.ts';

      const created = await app.inject({
        method: 'POST',
        url: '/eval-cases',
        payload: {
          owner_kind: 'agent',
          owner_id: agent.id,
          name: 'ac57-case',
          input_diff: makeDiffPatch(path),
          expected_output: { findings: [] }, // -> derived must_not_flag (AC-54)
        },
      });
      expect(created.statusCode).toBe(201);
      const caseId = created.json().id as string;
      expect(created.json().expectation_kind).toBe('must_not_flag');

      // Contradict it directly on the row — the ONLY way this can happen: no
      // route can set expectation_kind after creation (AC-55).
      await pg.handle.db
        .update(t.evalCases)
        .set({ expectationKind: 'must_find' })
        .where(eq(t.evalCases.id, caseId));
      const [contradicted] = await pg.handle.db.select().from(t.evalCases).where(eq(t.evalCases.id, caseId));
      expect(contradicted!.expectationKind).toBe('must_find');

      const run = await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/eval-cases/${caseId}/run`,
      });
      expect(run.statusCode).toBe(200);
      const record = run.json() as EvalRunRecord;
      // The model produced nothing, expected_output expects nothing — the
      // scorer (`eval/helpers.ts#expectedFindings` + `scoring.ts`) computes
      // pass/recall/precision from the EXPECTATIONS, ignoring the
      // contradicting stored `must_find` kind entirely.
      expect(record.pass).toBe(true);
      expect(record.recall).toBe(1);
      expect(record.precision).toBe(1);

      await app.close();
    },
  );

  // ---- expectation-kind plan, step 11 — the per-case run route -------------
  // ---- (AC-63, AC-69, AC-70, AC-71) -----------------------------------------

  it(
    'a single-case run (success AND failure) leaves the agent\'s current/recent_batches/trend/alert ' +
      'BYTE-IDENTICAL before and after, while the run itself shows up in recent_runs for its own case and in ' +
      'NO batch, trend point, or GET /eval/overview row (AC-63, AC-69, AC-70, AC-71)',
    async () => {
      const path = 'src/eval/ac71-batch-target.ts';
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
      const app = await makeApp(llm);
      const agent = await createAgent(app, 'AC71 Owner');

      // Give the agent a REAL, measured batch FIRST — current/trend/alert
      // then carry non-placeholder numbers, so a single-case run silently
      // moving them would be an observable change, not a "0 == 0" false
      // negative.
      const batchCase = await app.inject({
        method: 'POST',
        url: '/eval-cases',
        payload: {
          owner_kind: 'agent',
          owner_id: agent.id,
          name: 'ac71-batch-case',
          input_diff: makeDiffPatch(path),
          expected_output: { findings: [{ file: path, start_line: FIXTURE_LINE, end_line: FIXTURE_LINE }] },
        },
      });
      expect(batchCase.statusCode).toBe(201);
      const batchRun = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
      expect(batchRun.statusCode).toBe(200);
      const originalBatchId = (batchRun.json() as AgentEvalBatch).batch_id;

      const before = (
        await app.inject({ method: 'GET', url: `/eval/dashboard?owner_id=${agent.id}` })
      ).json() as EvalDashboard;
      expect(before.recent_batches).toHaveLength(1);
      expect(before.current.traces_total).toBeGreaterThan(0);

      // ---- success: a second case, run singly, outside the batch ----
      const successCase = await app.inject({
        method: 'POST',
        url: '/eval-cases',
        payload: {
          owner_kind: 'agent',
          owner_id: agent.id,
          name: 'ac71-single-success',
          input_diff: makeDiffPatch(path),
          expected_output: { findings: [{ file: path, start_line: FIXTURE_LINE, end_line: FIXTURE_LINE }] },
        },
      });
      expect(successCase.statusCode).toBe(201);
      const successCaseId = successCase.json().id as string;

      const successRun = await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/eval-cases/${successCaseId}/run`,
      });
      expect(successRun.statusCode).toBe(200);
      const successRecord = successRun.json() as EvalRunRecord;
      expect(successRecord.case_id).toBe(successCaseId);
      expect(successRecord.batch_id).toBeNull();
      expect(successRecord.agent_version).toBe(agent.version);
      expect(successRecord.pass).toBe(true);
      expect(successRecord.error).toBeNull();

      // AC-63: exactly one model call for this one case (three so far: one
      // for the batch case above, one for this one — never two for one run).
      const structuredCalls = llm.calls.filter((c) => c.method === 'completeStructured');
      expect(structuredCalls).toHaveLength(2);

      const successRows = await pg.handle.db
        .select()
        .from(t.evalRuns)
        .where(eq(t.evalRuns.caseId, successCaseId));
      expect(successRows).toHaveLength(1);
      expect(successRows[0]!.batchId).toBeNull();
      expect(successRows[0]!.agentVersion).toBe(agent.version);

      const afterSuccess = (
        await app.inject({ method: 'GET', url: `/eval/dashboard?owner_id=${agent.id}` })
      ).json() as EvalDashboard;
      expect(afterSuccess.current).toEqual(before.current);
      expect(afterSuccess.recent_batches).toEqual(before.recent_batches);
      expect(afterSuccess.trend).toEqual(before.trend);
      expect(afterSuccess.alert).toEqual(before.alert);

      // AC-70: it DOES show up in recent_runs for its own case…
      const successRunsInDashboard = afterSuccess.recent_runs.filter((r) => r.case_id === successCaseId);
      expect(successRunsInDashboard).toHaveLength(1);
      expect(successRunsInDashboard[0]!.id).toBe(successRecord.id);

      // ---- failure: a third case with an EMPTY input_diff — runOneCase
      // throws BEFORE any model call (the "empty input_diff" branch AC-69
      // names explicitly), the run still 200s with pass:null + a reason, and
      // the row is still persisted (NFR Спостережуваність).
      const failCase = await app.inject({
        method: 'POST',
        url: '/eval-cases',
        payload: {
          owner_kind: 'agent',
          owner_id: agent.id,
          name: 'ac71-single-failure',
          input_diff: '',
          expected_output: { findings: [] },
        },
      });
      expect(failCase.statusCode).toBe(201);
      const failCaseId = failCase.json().id as string;

      const failRun = await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/eval-cases/${failCaseId}/run`,
      });
      expect(failRun.statusCode).toBe(200);
      const failRecord = failRun.json() as EvalRunRecord;
      expect(failRecord.pass).toBeNull();
      expect(failRecord.error).not.toBeNull();
      expect(failRecord.error!.code).toBe('eval_case_empty');
      expect(failRecord.batch_id).toBeNull();

      // The empty-diff branch never calls the model — still exactly the same
      // two structured calls as after the success run above.
      expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(2);

      const failRows = await pg.handle.db.select().from(t.evalRuns).where(eq(t.evalRuns.caseId, failCaseId));
      expect(failRows).toHaveLength(1);
      expect(failRows[0]!.pass).toBeNull();
      expect(failRows[0]!.batchId).toBeNull();
      expect(failRows[0]!.errorReason).toBeTruthy();

      const afterFailure = (
        await app.inject({ method: 'GET', url: `/eval/dashboard?owner_id=${agent.id}` })
      ).json() as EvalDashboard;
      // The core assertion: a FAILED single-case run moves the aggregates
      // exactly as little as a successful one did — still byte-identical to
      // the pre-single-run snapshot.
      expect(afterFailure.current).toEqual(before.current);
      expect(afterFailure.recent_batches).toEqual(before.recent_batches);
      expect(afterFailure.trend).toEqual(before.trend);
      expect(afterFailure.alert).toEqual(before.alert);

      const failRunsInDashboard = afterFailure.recent_runs.filter((r) => r.case_id === failCaseId);
      expect(failRunsInDashboard).toHaveLength(1);
      expect(failRunsInDashboard[0]!.error).toEqual(failRecord.error);

      // AC-71: neither single-case run minted a new batch, a new trend point,
      // or a new GET /eval/overview row for THIS agent — filtered by
      // `agent_id` because `recent_batches` here is the GLOBAL top-N window
      // shared with every other agent this whole suite has created, not a
      // fixture scoped to this one test.
      const overview = (
        await app.inject({ method: 'GET', url: '/eval/overview' })
      ).json() as EvalDashboardOverview;
      const thisAgentsGlobalBatches = overview.recent_batches.filter((b) => b.agent_id === agent.id);
      expect(thisAgentsGlobalBatches).toHaveLength(1);
      expect(thisAgentsGlobalBatches[0]!.batch_id).toBe(originalBatchId);
      const overviewSummary = overview.agents.find((a) => a.agent_id === agent.id);
      expect(overviewSummary).toBeDefined();
      expect(overviewSummary!.last_batch!.batch_id).toBe(originalBatchId);
      expect(overviewSummary!.trend).toHaveLength(1);

      await app.close();
    },
    30_000,
  );

  it('POST /agents/:id/eval-cases/:caseId/run 404s when the case belongs to a DIFFERENT agent', async () => {
    const app = await makeApp();
    const owner = await createAgent(app, 'Run404 Owner');
    const other = await createAgent(app, 'Run404 Other');

    const created = await app.inject({
      method: 'POST',
      url: '/eval-cases',
      payload: {
        owner_kind: 'agent',
        owner_id: owner.id,
        name: 'run404-case',
        input_diff: makeDiffPatch('src/eval/run404.ts'),
        expected_output: { findings: [] },
      },
    });
    expect(created.statusCode).toBe(201);
    const caseId = created.json().id as string;

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${other.id}/eval-cases/${caseId}/run`,
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it(
    'POST /agents/:id/eval-cases/:caseId/run answers 409 no_provider_key BEFORE any DB write, when no ' +
      'provider key is configured (no llm override, an EMPTY secrets provider)',
    async () => {
      const app = await makeApp(undefined, { secrets: new MockSecretsProvider({}) });
      const agent = await createAgent(app, 'Run409 Owner');

      const created = await app.inject({
        method: 'POST',
        url: '/eval-cases',
        payload: {
          owner_kind: 'agent',
          owner_id: agent.id,
          name: 'run409-case',
          input_diff: makeDiffPatch('src/eval/run409.ts'),
          expected_output: { findings: [] },
        },
      });
      expect(created.statusCode).toBe(201);
      const caseId = created.json().id as string;

      const res = await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/eval-cases/${caseId}/run`,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('no_provider_key');

      const rows = await pg.handle.db.select().from(t.evalRuns).where(eq(t.evalRuns.caseId, caseId));
      expect(rows).toHaveLength(0);

      await app.close();
    },
  );

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
    // POST /agents/:id/eval-cases/:caseId/run (expectation-kind plan, step
    // 11: the exact method+path `useRunAgentEvalCase()` posts to),
    // GET /eval/overview, GET /eval/dashboard.
    expect(app.hasRoute({ method: 'GET', url: '/eval-cases' })).toBe(true);
    expect(app.hasRoute({ method: 'POST', url: '/eval-cases' })).toBe(true);
    expect(app.hasRoute({ method: 'GET', url: '/eval-cases/:id' })).toBe(true);
    expect(app.hasRoute({ method: 'PUT', url: '/eval-cases/:id' })).toBe(true);
    expect(app.hasRoute({ method: 'DELETE', url: '/eval-cases/:id' })).toBe(true);
    expect(app.hasRoute({ method: 'POST', url: '/findings/:id/eval-case' })).toBe(true);
    expect(app.hasRoute({ method: 'POST', url: '/agents/:id/eval-runs' })).toBe(true);
    expect(app.hasRoute({ method: 'POST', url: '/agents/:id/eval-cases/:caseId/run' })).toBe(true);
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

  // ---- The grounding-header fix ----------------------------------------
  //
  // GitHub's `pr_files.patch` is hunks only. A case that stored it raw parsed
  // to ZERO files, so the citation-grounding gate dropped every finding as
  // uncited: a `must_not_flag` case passed no matter what the agent did, and a
  // `must_find` case could never pass. The suite missed it because every
  // fixture here was already headered — a shape real `pr_files` never has.

  /** One finding at the fixture line, as the model would return it. */
  function flaggingLlm(path: string, line = FIXTURE_LINE): MockLLMProvider {
    return new MockLLMProvider('openai', {
      structured: {
        verdict: 'comment',
        summary: 'ok',
        score: 80,
        findings: [
          {
            id: 'f1',
            severity: 'CRITICAL',
            category: 'security',
            title: 'Hardcoded key',
            file: path,
            start_line: line,
            end_line: line,
            rationale: 'r',
            confidence: 0.9,
          },
        ],
      },
    });
  }

  it('stores a parseable diff when the pr_files patch is GitHub-shaped (hunks only)', async () => {
    const app = await makeApp();
    const workspaceId = await defaultWorkspaceId();
    const prId = await pr482Id();
    const agent = await createAgent(app, 'Header Creation');

    const path = 'src/eval/header-creation.ts';
    // The real shape: no `diff --git`, no `+++`.
    await pg.handle.db
      .insert(t.prFiles)
      .values({ prId, path, additions: 1, deletions: 0, patch: makeGithubPatch() });
    const findingId = await insertDecidedFinding({
      prId,
      workspaceId,
      agentId: agent.id,
      file: path,
      decision: 'accepted',
    });

    const res = await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    expect(res.statusCode).toBe(201);
    const created = res.json();

    expect(created.input_diff.startsWith(`diff --git a/${path} b/${path}`)).toBe(true);
    // The property that actually matters: the stored diff names its file.
    expect(parseUnifiedDiff(created.input_diff).files.map((f: { path: string }) => f.path)).toEqual([
      path,
    ]);

    await app.close();
  });

  it('FAILS a must_not_flag case when the agent flags — the bug this fix exists for', async () => {
    const path = 'src/eval/header-negative.ts';
    const llm = flaggingLlm(path);
    const app = await makeApp(llm);
    const workspaceId = await defaultWorkspaceId();
    const prId = await pr482Id();
    const agent = await createAgent(app, 'Header Negative');

    await pg.handle.db
      .insert(t.prFiles)
      .values({ prId, path, additions: 1, deletions: 0, patch: makeGithubPatch() });
    const findingId = await insertDecidedFinding({
      prId,
      workspaceId,
      agentId: agent.id,
      file: path,
      decision: 'dismissed',
    });
    await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });

    const run = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(run.statusCode).toBe(200);
    const batch = run.json();
    const result = batch.cases[0];

    // Before the fix these read: grounded_count 0, citation_accuracy 0,
    // precision 1, pass TRUE — a case that could never fail.
    expect(result.raw_count).toBe(1);
    expect(result.grounded_count).toBe(1);
    expect(result.citation_accuracy).toBe(1);
    expect(result.precision).toBe(0);
    expect(result.pass).toBe(false);
    expect(batch.traces_passed).toBe(0);

    await app.close();
  });

  it('PASSES a must_find case created from a GitHub-shaped patch when the agent flags the expected line', async () => {
    const path = 'src/eval/header-positive.ts';
    const llm = flaggingLlm(path);
    const app = await makeApp(llm);
    const workspaceId = await defaultWorkspaceId();
    const prId = await pr482Id();
    const agent = await createAgent(app, 'Header Positive');

    await pg.handle.db
      .insert(t.prFiles)
      .values({ prId, path, additions: 1, deletions: 0, patch: makeGithubPatch() });
    const findingId = await insertDecidedFinding({
      prId,
      workspaceId,
      agentId: agent.id,
      file: path,
      decision: 'accepted',
    });
    await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });

    const run = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    const result = run.json().cases[0];

    expect(result.grounded_count).toBe(1);
    expect(result.recall).toBe(1);
    expect(result.precision).toBe(1);
    expect(result.pass).toBe(true);

    await app.close();
  });

  it('still drops a finding that cites a line outside the hunk — the gate is not disabled', async () => {
    const path = 'src/eval/header-offhunk.ts';
    // Same fixture, but the model cites a line the diff never touched.
    const llm = flaggingLlm(path, 999);
    const app = await makeApp(llm);
    const workspaceId = await defaultWorkspaceId();
    const prId = await pr482Id();
    const agent = await createAgent(app, 'Header Off Hunk');

    await pg.handle.db
      .insert(t.prFiles)
      .values({ prId, path, additions: 1, deletions: 0, patch: makeGithubPatch() });
    const findingId = await insertDecidedFinding({
      prId,
      workspaceId,
      agentId: agent.id,
      file: path,
      decision: 'accepted',
    });
    await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });

    const run = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    const result = run.json().cases[0];

    // Without this, the two tests above would also pass if grounding had
    // simply been turned off.
    expect(result.raw_count).toBe(1);
    expect(result.grounded_count).toBe(0);
    expect(result.recall).toBe(0);
    expect(result.pass).toBe(false);

    await app.close();
  });

  it('errors a hand-pasted headerless case instead of scoring it, without calling the model', async () => {
    const llm = new MockLLMProvider('openai');
    const app = await makeApp(llm);
    const agent = await createAgent(app, 'Header Guard');

    const created = await app.inject({
      method: 'POST',
      url: '/eval-cases',
      payload: {
        owner_kind: 'agent',
        owner_id: agent.id,
        name: 'pasted-without-header',
        input_diff: '@@ -1 +1 @@\n-a\n+b',
        expected_output: { findings: [] },
      },
    });
    expect(created.statusCode).toBe(201);

    const run = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    const result = run.json().cases[0];

    expect(result.pass).toBeNull();
    expect(result.error.code).toBe('eval_case_unparseable_diff');
    expect(result.error.message).toContain('pasted-without-header');
    // Never the diff text itself (AC-25 / NFR Секрети).
    expect(result.error.message).not.toContain('+b');
    // The guard fires before the provider is ever reached.
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(0);

    await app.close();
  });
});
