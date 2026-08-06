import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import { MAX_SKILL_BODY_CHARS } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[skills] Docker not available — skipping integration tests.');
}

/**
 * Skills Lab, end to end over a real Postgres: CRUD, the immutable body
 * history (including the lazy v1 backfill), append-only restore, the
 * agent↔skill link read path, and the run-level stats attribution.
 *
 * Eval EXECUTION is not covered here — it makes a real model call, and the
 * harness logic is pinned hermetically in `skills-eval.test.ts`.
 */
d('skills module', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  const createBody = {
    name: 'no-console-log',
    description: 'Ban console.log in shipped code.',
    type: 'convention' as const,
    body: 'Flag every console.log added by the diff.',
  };

  // ---- CRUD ---------------------------------------------------------------

  it('creates, reads, filters and deletes a skill', async () => {
    const app = await makeApp();

    const created = await app.inject({ method: 'POST', url: '/skills', payload: createBody });
    expect(created.statusCode).toBe(201);
    const skill = created.json();
    expect(skill).toMatchObject({
      name: 'no-console-log',
      type: 'convention',
      // Defaults come from the contract, not the handler.
      source: 'manual',
      enabled: true,
      version: 1,
    });

    const one = await app.inject({ method: 'GET', url: `/skills/${skill.id}` });
    expect(one.json().body).toBe(createBody.body);

    const byType = await app.inject({ method: 'GET', url: '/skills?type=convention' });
    expect(byType.json().map((s: { name: string }) => s.name)).toContain('no-console-log');
    const bySecurity = await app.inject({ method: 'GET', url: '/skills?type=security' });
    expect(bySecurity.json().map((s: { name: string }) => s.name)).not.toContain('no-console-log');

    await app.inject({ method: 'PUT', url: `/skills/${skill.id}`, payload: { enabled: false } });
    const enabledOnly = await app.inject({ method: 'GET', url: '/skills?enabled=true' });
    expect(enabledOnly.json().map((s: { id: string }) => s.id)).not.toContain(skill.id);

    const deleted = await app.inject({ method: 'DELETE', url: `/skills/${skill.id}` });
    expect(deleted.json()).toEqual({ deleted: skill.id });
    expect((await app.inject({ method: 'GET', url: `/skills/${skill.id}` })).statusCode).toBe(404);

    await app.close();
  });

  it('rejects an unknown skill and a non-uuid id at the edge', async () => {
    const app = await makeApp();
    const ghost = '00000000-0000-0000-0000-000000000000';
    expect((await app.inject({ method: 'GET', url: `/skills/${ghost}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/skills/nope' })).statusCode).toBe(422);
    await app.close();
  });

  // ---- version round-trip -------------------------------------------------

  it('versions only on a CHANGED body, and backfills v1 on the first edit', async () => {
    const app = await makeApp();
    const id = (
      await app.inject({ method: 'POST', url: '/skills', payload: { ...createBody, name: 'versioned' } })
    ).json().id as string;

    // A never-edited skill still lists its current version (synthesized).
    const fresh = (await app.inject({ method: 'GET', url: `/skills/${id}/versions` })).json();
    expect(fresh).toHaveLength(1);
    expect(fresh[0]).toMatchObject({ version: 1, body_chars: createBody.body.length });
    expect(fresh[0].body).toBeUndefined();

    // Metadata-only edit: no bump.
    const renamed = await app.inject({
      method: 'PUT',
      url: `/skills/${id}`,
      payload: { description: 'Renamed only' },
    });
    expect(renamed.json().version).toBe(1);

    // Re-saving the SAME body: still no bump.
    const resaved = await app.inject({
      method: 'PUT',
      url: `/skills/${id}`,
      payload: { body: createBody.body },
    });
    expect(resaved.json().version).toBe(1);

    // A changed body mints v2 AND backfills the v1 row that never existed.
    const edited = await app.inject({
      method: 'PUT',
      url: `/skills/${id}`,
      payload: { body: 'Flag console.log AND debugger statements.' },
    });
    expect(edited.json().version).toBe(2);

    const versions = (await app.inject({ method: 'GET', url: `/skills/${id}/versions` })).json();
    expect(versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);

    const v1 = (await app.inject({ method: 'GET', url: `/skills/${id}/versions/1` })).json();
    expect(v1.body).toBe(createBody.body);
    const v2 = (await app.inject({ method: 'GET', url: `/skills/${id}/versions/2` })).json();
    expect(v2.body).toBe('Flag console.log AND debugger statements.');

    expect(
      (await app.inject({ method: 'GET', url: `/skills/${id}/versions/99` })).statusCode,
    ).toBe(404);
    await app.close();
  });

  it('refuses a patch that would change nothing, instead of answering 200', async () => {
    const app = await makeApp();
    const id = (
      await app.inject({ method: 'POST', url: '/skills', payload: { ...createBody, name: 'strict' } })
    ).json().id as string;

    // A typo'd key: zod strips unknown keys, so without `.strict()` this
    // validates, matches no field, and reports success having done nothing.
    const typo = await app.inject({
      method: 'PUT',
      url: `/skills/${id}`,
      payload: { enabeld: false },
    });
    expect(typo.statusCode).toBe(422);

    // An empty patch reaches `.set({})`, which is not valid SQL — a 500 dressed
    // as a client mistake.
    const empty = await app.inject({ method: 'PUT', url: `/skills/${id}`, payload: {} });
    expect(empty.statusCode).toBe(422);

    // A body past the cap: the prompt slot is bounded at the edge, not at the
    // provider, where it would surface as a failed run instead.
    const huge = await app.inject({
      method: 'PUT',
      url: `/skills/${id}`,
      payload: { body: 'x'.repeat(MAX_SKILL_BODY_CHARS + 1) },
    });
    expect(huge.statusCode).toBe(422);

    // Nothing above touched the row.
    const after = (await app.inject({ method: 'GET', url: `/skills/${id}` })).json();
    expect(after).toMatchObject({ enabled: true, version: 1, body: createBody.body });
    await app.close();
  });

  it('restores an old body as a NEW version instead of rewinding', async () => {
    const app = await makeApp();
    const id = (
      await app.inject({ method: 'POST', url: '/skills', payload: { ...createBody, name: 'restorable' } })
    ).json().id as string;
    await app.inject({ method: 'PUT', url: `/skills/${id}`, payload: { body: 'second body' } });
    await app.inject({ method: 'PUT', url: `/skills/${id}`, payload: { body: 'third body' } });

    const restored = await app.inject({
      method: 'POST',
      url: `/skills/${id}/versions/1/restore`,
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({ version: 4, body: createBody.body });

    // History is append-only: 1..3 survive untouched, 4 is the copy.
    const versions = (await app.inject({ method: 'GET', url: `/skills/${id}/versions` })).json();
    expect(versions.map((v: { version: number }) => v.version)).toEqual([4, 3, 2, 1]);
    const v2 = (await app.inject({ method: 'GET', url: `/skills/${id}/versions/2` })).json();
    expect(v2.body).toBe('second body');

    await app.close();
  });

  // ---- links --------------------------------------------------------------

  it('reports the agents that link a skill, in each agent\'s prompt order', async () => {
    const app = await makeApp();
    const { db } = pg.handle;

    const skills = (await app.inject({ method: 'GET', url: '/skills' })).json() as {
      id: string;
      name: string;
    }[];
    const rubric = skills.find((s) => s.name === 'pr-quality-rubric')!;
    const gate = skills.find((s) => s.name === 'secret-leakage-gate')!;

    const [security] = await db
      .select()
      .from(t.agents)
      .where(eq(t.agents.name, 'Security Reviewer'));

    // Seeded order: rubric first, gate second.
    let usage = (await app.inject({ method: 'GET', url: `/skills/${gate.id}/agents` })).json();
    expect(usage).toEqual([
      { agent_id: security!.id, agent_name: 'Security Reviewer', order: 1, agent_enabled: true },
    ]);

    // Reorder through the agents module; the skill's view follows.
    await app.inject({
      method: 'POST',
      url: `/agents/${security!.id}/skills`,
      payload: { skill_ids: [gate.id, rubric.id] },
    });
    usage = (await app.inject({ method: 'GET', url: `/skills/${gate.id}/agents` })).json();
    expect(usage[0].order).toBe(0);

    // Restore the seeded order so later assertions are not order-dependent.
    await app.inject({
      method: 'POST',
      url: `/agents/${security!.id}/skills`,
      payload: { skill_ids: [rubric.id, gate.id] },
    });
    await app.close();
  });

  // ---- stats --------------------------------------------------------------

  it('attributes runs and findings to a skill through run_skills', async () => {
    const app = await makeApp();
    const { db } = pg.handle;

    const [workspace] = await db
      .select()
      .from(t.workspaces)
      .where(eq(t.workspaces.name, 'default'));
    const workspaceId = workspace!.id;

    const [skill] = await db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, 'no-then-chains')));
    const [agent] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'General Reviewer')));
    const [pull] = await db.select().from(t.pullRequests).where(eq(t.pullRequests.number, 482));

    // Zero attribution before any run has used it.
    const before = (await app.inject({ method: 'GET', url: `/skills/${skill!.id}/stats` })).json();
    expect(before).toMatchObject({
      pull_count_30d: 0,
      runs_total: 0,
      findings_30d: 0,
      accept_rate: null,
      findings_by_category: [],
      used_by: [],
    });

    // A run that USED the skill, with a review and three triaged findings.
    const [run] = await db
      .insert(t.agentRuns)
      .values({
        workspaceId,
        agentId: agent!.id,
        prId: pull!.id,
        provider: 'openrouter',
        model: 'deepseek/deepseek-v4-flash',
        status: 'done',
      })
      .returning();
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pull!.id,
        agentId: agent!.id,
        runId: run!.id,
        kind: 'review',
        verdict: 'comment',
        summary: 'x',
        score: 70,
        model: 'deepseek/deepseek-v4-flash',
      })
      .returning();
    await db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/api/users.ts',
        startLine: 10,
        endLine: 10,
        severity: 'WARNING',
        category: 'style',
        title: 'then chain',
        rationale: 'r',
        confidence: 0.8,
        acceptedAt: new Date(),
      },
      {
        reviewId: review!.id,
        file: 'src/api/users.ts',
        startLine: 20,
        endLine: 20,
        severity: 'SUGGESTION',
        category: 'style',
        title: 'another then chain',
        rationale: 'r',
        confidence: 0.6,
        dismissedAt: new Date(),
      },
      {
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 11,
        endLine: 11,
        severity: 'CRITICAL',
        category: 'security',
        title: 'key',
        rationale: 'r',
        confidence: 0.9,
      },
    ]);
    await db
      .insert(t.runSkills)
      .values({ runId: run!.id, skillId: skill!.id, skillVersion: 1, order: 0 });

    const stats = (await app.inject({ method: 'GET', url: `/skills/${skill!.id}/stats` })).json();
    expect(stats).toMatchObject({
      pull_count_30d: 1,
      runs_total: 1,
      findings_30d: 3,
      // one accepted, one dismissed, one untriaged → 1/2
      accept_rate: 0.5,
    });
    expect(stats.findings_by_category).toEqual([
      { category: 'style', count: 2 },
      { category: 'security', count: 1 },
    ]);

    // A skill nobody's run used stays at zero — attribution is per run, not global.
    const [other] = await db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, 'secret-leakage-gate')));
    const otherStats = (
      await app.inject({ method: 'GET', url: `/skills/${other!.id}/stats` })
    ).json();
    expect(otherStats).toMatchObject({ runs_total: 0, findings_30d: 0 });

    await app.close();
  });

  // ---- eval cases ---------------------------------------------------------

  it('CRUDs eval cases under their owning skill', async () => {
    const app = await makeApp();
    const { db } = pg.handle;
    const [rubric] = await db.select().from(t.skills).where(eq(t.skills.name, 'pr-quality-rubric'));

    const seeded = (
      await app.inject({ method: 'GET', url: `/skills/${rubric!.id}/eval-cases` })
    ).json();
    expect(seeded.map((c: { name: string }) => c.name)).toContain('stripe-key-leak');

    const created = await app.inject({
      method: 'POST',
      url: `/skills/${rubric!.id}/eval-cases`,
      payload: {
        name: 'no-tests',
        input_diff: 'diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1,1 +1,2 @@\n+x',
        expected_output: { findings: [{ severity: 'WARNING', category: 'test' }] },
      },
    });
    expect(created.statusCode).toBe(201);
    const caseId = created.json().id as string;
    expect(created.json()).toMatchObject({ owner_kind: 'skill', owner_id: rubric!.id });

    const updated = await app.inject({
      method: 'PUT',
      url: `/eval-cases/${caseId}`,
      payload: { notes: 'Missing test coverage must be flagged.' },
    });
    expect(updated.json().notes).toBe('Missing test coverage must be flagged.');

    // A malformed expectation is rejected at the edge, not silently ignored.
    const bad = await app.inject({
      method: 'PUT',
      url: `/eval-cases/${caseId}`,
      payload: { expected_output: { findings: [{ severity: 'blocker' }] } },
    });
    expect(bad.statusCode).toBe(422);

    const removed = await app.inject({ method: 'DELETE', url: `/eval-cases/${caseId}` });
    expect(removed.json()).toEqual({ deleted: caseId });
    expect(
      (await app.inject({ method: 'DELETE', url: `/eval-cases/${caseId}` })).statusCode,
    ).toBe(404);

    await app.close();
  });
});
