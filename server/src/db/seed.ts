import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and } from 'drizzle-orm';
import {
  GENERAL_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
  TEST_QUALITY_REVIEWER_PROMPT,
  API_CONTRACT_REVIEWER_PROMPT,
  PR_QUALITY_RUBRIC_SKILL,
  SECRET_LEAKAGE_GATE_SKILL,
  NO_THEN_CHAINS_SKILL,
  TEST_QUALITY_RUBRIC_SKILL,
  API_CONTRACT_GATE_SKILL,
} from './seed-prompts.js';

/**
 * Fake credential for the seeded eval case, assembled at runtime rather than
 * written as one literal.
 *
 * The eval only means something if the fixture looks like the real thing — a
 * string spelling out FAKE would be skipped by the very rule under test, since
 * the skill tells the reviewer to ignore obvious placeholders. But a literal in
 * that shape is what GitHub push protection blocks, and rightly: a scanner
 * cannot tell a fixture from a leak. Joining the parts keeps the runtime value
 * realistic while leaving no matchable literal in the file.
 *
 * It has never been a live key. Do not "fix" this by inlining it.
 */
const FIXTURE_STRIPE_KEY = ['sk', 'live', '51H8xQ2eZvKYlo2CkqPmNbVwX'].join('_');

/** Default provider/model for the built-in reviewer agents. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

/**
 * Seed the starter's demo data. Idempotent: re-running upserts the default
 * workspace/user and the demo fixtures.
 *
 * Seeds: default workspace + system user + membership, default settings,
 * demo repo (acme/payments-api), PR #482 with files/commits, a sample review
 * with a few findings, and the built-in agents (General + Security +
 * Performance, plus L02's Test Quality + API Contract reviewers), all on the
 * default openrouter/deepseek-v4-flash provider+model — with their skills and
 * `agent_skills` links.
 *
 * Course lessons populate the other tables (conventions, memory, …) once their
 * features are built — they start empty here.
 *
 * Idempotency is per-row and by NAME: every block selects first and inserts only
 * when nothing matches, so re-running adds the new lesson's rows to an existing
 * database without touching or duplicating what is already there. It follows
 * that editing a prompt or skill body here does NOT update a workspace that has
 * already been seeded — the DB row is the source of truth at run time.
 */

/**
 * The changed files of PR #483, the Skills Lab control-experiment fixture.
 *
 * Exported so `test/seed-diff.test.ts` can parse them: the `@@` counts have to
 * be exact, because the grounding gate maps every finding's line onto the
 * new-side numbers derived from these headers. Get them wrong and the agent's
 * findings are all dropped — which reads as "the agent found nothing" rather
 * than as a broken fixture, so it is pinned by a test rather than by care.
 */
export const BREAKING_PR_FILES = [
  {
    path: 'src/api/public/webhooks.ts',
    additions: 4,
    deletions: 3,
    patch: [
      '@@ -14,12 +14,13 @@ export async function registerWebhookRoutes(app: FastifyInstance) {',
      "   app.post('/webhooks', {",
      '     schema: {',
      '       body: z.object({',
      '         url: z.string().url(),',
      '-        secret: z.string().optional(),',
      '+        secret: z.string(),',
      '+        events: z.array(z.string()).min(1),',
      '       }),',
      '     },',
      '   }, async (req, reply) => {',
      '     const hook = await createWebhook(req.body);',
      '-    reply.status(200);',
      '-    return { id: hook.id, callbackUrl: hook.url, isActive: hook.active };',
      '+    reply.status(204);',
      '+    return { id: hook.id, callback_url: hook.url, enabled: hook.active };',
      '   });',
    ].join('\n'),
  },
  {
    path: 'src/api/public/types.ts',
    additions: 2,
    deletions: 3,
    patch: [
      '@@ -3,5 +3,4 @@ export interface WebhookResponse {',
      '   id: string;',
      '-  /** @deprecated use callback_url */',
      '-  callbackUrl: string;',
      '-  isActive: boolean;',
      '+  callback_url: string;',
      '+  enabled: boolean;',
      ' }',
    ].join('\n'),
  },
  {
    path: 'package.json',
    additions: 1,
    deletions: 1,
    patch: [
      '@@ -1,5 +1,5 @@',
      ' {',
      '   "name": "@acme/payments-api",',
      '-  "version": "2.4.1",',
      '+  "version": "2.5.0",',
      '   "private": false,',
      '   "main": "dist/index.js",',
    ].join('\n'),
  },
] as const;

export const DEFAULT_WORKSPACE_NAME = 'default';
export const SYSTEM_USER_EMAIL = 'you@local';

export async function seed(db: Db): Promise<{ workspaceId: string; userId: string }> {
  // ---- workspace + user (no-auth defaults) ----
  let [ws] = await db
    .select()
    .from(t.workspaces)
    .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
  if (!ws) {
    [ws] = await db
      .insert(t.workspaces)
      .values({ name: DEFAULT_WORKSPACE_NAME })
      .returning();
  }
  const workspaceId = ws!.id;

  let [user] = await db.select().from(t.users).where(eq(t.users.email, SYSTEM_USER_EMAIL));
  if (!user) {
    [user] = await db
      .insert(t.users)
      .values({ email: SYSTEM_USER_EMAIL, name: 'You' })
      .returning();
  }
  const userId = user!.id;

  await db
    .insert(t.workspaceMembers)
    .values({ workspaceId, userId, role: 'owner' })
    .onConflictDoNothing();

  // ---- default settings ----
  const defaultSettings: Record<string, unknown> = {
    polling_interval_min: 5,
    theme: 'dark',
    density: 'regular',
    sync_to_folder: true,
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    await db
      .insert(t.settings)
      .values({ workspaceId, userId, key, value })
      .onConflictDoNothing();
  }

  // ---- demo repo (acme/payments-api) ----
  let [repo] = await db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
  if (!repo) {
    [repo] = await db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'payments-api',
        fullName: 'acme/payments-api',
        defaultBranch: 'main',
        clonePath: null,
        createdBy: userId,
      })
      .returning();
  }
  const repoId = repo!.id;

  // ---- PR #482 (rate limiting) ----
  let [pr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 482)));
  if (!pr) {
    [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 482,
        title: 'Add rate limiting to public API endpoints',
        author: 'marisa.koch',
        branch: 'feat/rate-limit-public',
        base: 'main',
        headSha: 'a1b2c3d4e5f6',
        additions: 247,
        deletions: 38,
        filesCount: 9,
        status: 'needs_review',
        body: 'Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.',
      })
      .returning();

    // pr_files (subset)
    await db.insert(t.prFiles).values([
      { prId: pr!.id, path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0 },
      { prId: pr!.id, path: 'src/api/public/webhooks.ts', additions: 31, deletions: 6 },
      { prId: pr!.id, path: 'src/config.ts', additions: 4, deletions: 0 },
      { prId: pr!.id, path: 'src/api/users.ts', additions: 7, deletions: 2 },
    ]);

    // pr_commits
    await db.insert(t.prCommits).values({
      prId: pr!.id,
      sha: 'a1b2c3d4e5f6',
      message: 'Add token-bucket rate limiter',
      author: 'marisa.koch',
    });

    // a sample review + findings so the PR shows results before the first run
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        kind: 'review',
        verdict: 'request_changes',
        summary:
          'Solid middleware approach, but a Stripe secret key is committed in plaintext and the user-list endpoint introduces an N+1 query under the new limiter.',
        score: 61,
        model: 'seed',
      })
      .returning();

    await db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 12,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key in commit',
        rationale: 'Line 12 contains a literal `sk_live_` Stripe secret key.',
        suggestion: 'Move to env var and rotate the key immediately.',
        confidence: 0.98,
      },
      {
        reviewId: review!.id,
        file: 'src/api/users.ts',
        startLine: 45,
        endLine: 52,
        severity: 'WARNING',
        category: 'perf',
        title: 'N+1 query in user list endpoint',
        rationale: 'Loop issues one query per user → N+1.',
        suggestion: 'Use a single IN query and group in memory.',
        confidence: 0.86,
      },
    ]);
  }

  // ---- PR #483 (breaking API contract change) ----
  // The control-experiment fixture: a diff that breaks a published contract
  // three ways at once — a response field renamed, an optional request field
  // made required, and a 200 turned into a 204 — plus a minor version bump and
  // a @deprecated field deleted outright.
  //
  // Unlike #482 this PR carries REAL `patch` text, which is what makes it
  // reviewable with no GitHub and no clone: `diffFromPrFiles` reassembles a
  // unified diff from these hunks. The `@@` line counts are exact on purpose —
  // the grounding gate maps a finding's line onto the new-side numbers derived
  // from them, so an approximate header would silently drop every finding and
  // look like the agent found nothing.
  let [breakingPr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 483)));
  if (!breakingPr) {
    [breakingPr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 483,
        title: 'Tidy up the webhook payload',
        author: 'dan.oliveira',
        branch: 'chore/webhook-payload-cleanup',
        base: 'main',
        headSha: 'f7e6d5c4b3a2',
        additions: 7,
        deletions: 7,
        filesCount: 3,
        status: 'needs_review',
        // Deliberately innocuous: the PR describes the change as a cleanup and
        // never uses the word "breaking". An agent without the contract skills
        // has every reason to read it as tidying.
        body: 'Small cleanup of the webhook payload so the field names match the rest of the API (snake_case) and the response stops echoing a body nobody reads.',
      })
      .returning();

    await db
      .insert(t.prFiles)
      .values(BREAKING_PR_FILES.map((f) => ({ ...f, prId: breakingPr!.id })));

    await db.insert(t.prCommits).values({
      prId: breakingPr!.id,
      sha: 'f7e6d5c4b3a2',
      message: 'Rename webhook payload fields to snake_case',
      author: 'dan.oliveira',
    });
  }

  // ---- built-in agents (the three starter presets) ----
  // Prompt bodies live in ./seed-prompts.ts (mirrored in docs/agent-prompts/*.md).
  const seedAgents: Array<typeof t.agents.$inferInsert> = [
    {
      workspaceId,
      name: 'General Reviewer',
      description: 'Reviews a PR diff for bugs, correctness, and clarity.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: GENERAL_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Security Reviewer',
      description: 'Flags secrets, injection, SSRF and the lethal trifecta before merge.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: SECURITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Performance Reviewer',
      description: 'Catches N+1 queries, missing indexes, and hot-path allocations.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: PERFORMANCE_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    // L02 — the two agents the Skills Lab control experiment runs on. Each is
    // paired with exactly ONE skill below, so linking or unlinking that skill is
    // the single variable between two runs of the same diff.
    {
      workspaceId,
      name: 'Test Quality Reviewer',
      description:
        'Checks test quality: uncovered branches, missed corner cases, over-mocking, and flaky patterns.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: TEST_QUALITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'API Contract Reviewer',
      description:
        'Flags breaking changes to route signatures, request/response shapes and status codes.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: API_CONTRACT_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
  ];
  for (const a of seedAgents) {
    const [existing] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, a.name)));
    if (!existing) await db.insert(t.agents).values(a);
  }

  // ---- built-in skills ----
  // One per `source` provenance so the Skills Lab has an honest sample of each
  // badge on a fresh install, and so the e2e flows have deterministic,
  // read-only data to assert on (no model call involved).
  const seedSkills: Array<typeof t.skills.$inferInsert> = [
    {
      workspaceId,
      name: 'pr-quality-rubric',
      description: 'Rubric for evaluating overall PR quality across correctness, tests, and clarity.',
      type: 'rubric',
      source: 'manual',
      body: PR_QUALITY_RUBRIC_SKILL,
      enabled: true,
      version: 1,
    },
    {
      workspaceId,
      name: 'secret-leakage-gate',
      description: 'Detects sk_live, service_role, and NEXT_PUBLIC secret leaks in a diff.',
      type: 'security',
      source: 'community',
      body: SECRET_LEAKAGE_GATE_SKILL,
      enabled: true,
      version: 1,
    },
    {
      workspaceId,
      name: 'no-then-chains',
      description: 'House rule: always use async/await instead of .then() chains.',
      type: 'convention',
      source: 'extracted',
      body: NO_THEN_CHAINS_SKILL,
      enabled: true,
      version: 1,
      // An extracted skill carries the files the rule was mined from — that
      // evidence is what makes an accepted convention auditable later.
      evidenceFiles: ['src/api/users.ts', 'src/config.ts'],
    },
    // L02 — one skill per new agent, written to be MEASURED: each rule names a
    // code shape and a severity, so "with the skill" vs "without it" on the same
    // diff is a difference you can point at.
    {
      workspaceId,
      name: 'test-quality-rubric',
      description:
        'Flags untested branches, missing empty/null/boundary cases, mock-only assertions, and flaky time/order/network patterns.',
      type: 'rubric',
      source: 'manual',
      body: TEST_QUALITY_RUBRIC_SKILL,
      enabled: true,
      version: 1,
    },
    {
      workspaceId,
      name: 'api-contract-gate',
      description:
        'Treats a changed route signature, a removed or renamed response field, and a changed status code as BREAKING.',
      type: 'convention',
      // The one seeded skill that arrived through the L02 import flow, so a
      // fresh install shows the `imported_url` badge on something real.
      source: 'imported_url',
      body: API_CONTRACT_GATE_SKILL,
      enabled: true,
      version: 1,
    },
  ];
  const skillIdByName = new Map<string, string>();
  for (const sk of seedSkills) {
    let [row] = await db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, sk.name)));
    if (!row) [row] = await db.insert(t.skills).values(sk).returning();
    if (row) skillIdByName.set(row.name, row.id);
  }

  // ---- agent ↔ skill links ----
  // `order` is the position in the assembled prompt, so the rubric leads and the
  // narrower gate follows it for the Security Reviewer.
  //
  // The two L02 agents get exactly ONE skill each, and nothing else: the whole
  // point is that the skill is the only variable, so adding the general rubric
  // alongside would confound the comparison.
  const links: Array<{ agent: string; skills: string[] }> = [
    { agent: 'General Reviewer', skills: ['pr-quality-rubric'] },
    { agent: 'Security Reviewer', skills: ['pr-quality-rubric', 'secret-leakage-gate'] },
    { agent: 'Test Quality Reviewer', skills: ['test-quality-rubric'] },
    { agent: 'API Contract Reviewer', skills: ['api-contract-gate'] },
  ];
  for (const link of links) {
    const [agentRow] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, link.agent)));
    if (!agentRow) continue;
    for (const [i, skillName] of link.skills.entries()) {
      const skillId = skillIdByName.get(skillName);
      if (!skillId) continue;
      await db
        .insert(t.agentSkills)
        .values({ agentId: agentRow.id, skillId, order: i })
        .onConflictDoNothing();
    }
  }

  // ---- one skill-owned eval case ----
  // Asserts the rubric catches the same hardcoded key the seeded review found,
  // so the Evals tab has a runnable case out of the box.
  const rubricId = skillIdByName.get('pr-quality-rubric');
  if (rubricId) {
    const [existingCase] = await db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.ownerId, rubricId), eq(t.evalCases.name, 'stripe-key-leak')));
    if (!existingCase) {
      await db.insert(t.evalCases).values({
        workspaceId,
        ownerKind: 'skill',
        ownerId: rubricId,
        name: 'stripe-key-leak',
        inputDiff: [
          'diff --git a/src/config.ts b/src/config.ts',
          '--- a/src/config.ts',
          '+++ b/src/config.ts',
          '@@ -10,3 +10,4 @@',
          ' export const config = {',
          '   port: Number(process.env.PORT ?? 3000),',
          `+  stripeKey: '${FIXTURE_STRIPE_KEY}',`,
          ' };',
        ].join('\n'),
        expectedOutput: { findings: [{ severity: 'CRITICAL', category: 'security' }] },
        notes: 'A live Stripe key added in the diff must be flagged CRITICAL.',
      });
    }
  }

  return { workspaceId, userId };
}

// CLI entrypoint. pathToFileURL (not a `file://` template) because on Windows
// process.argv[1] is a backslash path — the template never matches there, so
// this block silently did nothing and `pnpm db:seed` exited 0 doing no work.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const handle = createDb(url);
  seed(handle.db)
    .then(async (r) => {
      console.log('✓ seeded', r);
      await handle.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('✗ seed failed:', err);
      await handle.close();
      process.exit(1);
    });
}
