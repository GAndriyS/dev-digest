import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and } from 'drizzle-orm';
import type { PrWhyBrief } from '@devdigest/shared';
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

/**
 * L05 — Project Context fixture docs. Written to disk under the demo repo's
 * fixture "clone" (see `writeContextFixture` below) so `GET /repos/:id/context`
 * and the seeded trace below have real content — no GitHub, no real clone.
 * Two files, one per configured root (`specs`, `docs`), matches interview
 * decision Q1 ("extend the seed — full e2e flow").
 *
 * SPEC-01 AC-36 adds a third: `INSIGHTS.md` at the fixture clone's ROOT (not
 * under an `insights/` directory — the spec's own default), matched by the
 * NEW file-name rule rather than by root, so the listing shows a badge that
 * comes from a name match, not a root. `attachedToDemoRun: false` — the
 * plan's Recommendations §1 was declined ("Default: as requested"): AC-36
 * only asks for a listing entry and a page badge, not a doc reaching the
 * seeded run's prompt, so this file is written and listed but deliberately
 * left OUT of `specsRead`/`prompt_assembly.specs` below.
 */
const CONTEXT_FIXTURE_FILES: ReadonlyArray<{
  relPath: string;
  content: string;
  attachedToDemoRun: boolean;
}> = [
  {
    relPath: 'specs/overview.md',
    content: [
      '# Payments API — Overview',
      '',
      'Handles payment intents, webhooks, and the public rate-limited endpoints',
      'for the acme storefront. See `docs/architecture.md` for the request path.',
      '',
    ].join('\n'),
    attachedToDemoRun: true,
  },
  {
    relPath: 'docs/architecture.md',
    content: [
      '# Architecture',
      '',
      '`src/middleware/ratelimit.ts` wraps every route under `src/api/public/**`',
      'with a token-bucket limiter before the request reaches its handler.',
      '',
    ].join('\n'),
    attachedToDemoRun: true,
  },
  {
    relPath: 'INSIGHTS.md',
    content: [
      '# Payments API — Insights',
      '',
      'Rate limiting only guards `src/api/public/**` — internal routes still have',
      'no per-IP budget. Revisit before opening any of them up externally.',
      '',
    ].join('\n'),
    attachedToDemoRun: false,
  },
];

/**
 * Write the fixture docs to `root` (idempotent: always the same content, so a
 * repeated `pnpm db:seed` overwrites in place rather than accumulating).
 */
async function writeContextFixture(root: string): Promise<void> {
  for (const f of CONTEXT_FIXTURE_FILES) {
    const abs = join(root, ...f.relPath.split('/'));
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, f.content, 'utf8');
  }
}

/**
 * Where the Project Context fixture clone goes — a directory the seed itself
 * exclusively owns, independent of `AppConfig.cloneDir`/`DEVDIGEST_CLONE_DIR`.
 *
 * Fix pass 1 (l05-sdd-project-context), item 2: the original version derived
 * this from `loadConfig().cloneDir` (falling back only when that landed
 * inside `server/clones/**`) and called `writeContextFixture` unconditionally
 * every `pnpm db:seed`. That broke two ways: (a) once `DEVDIGEST_CLONE_DIR`
 * changed between seed runs, the fixture was written to the NEW path while
 * `repos.clonePath` — set only once, when it was still null — kept pointing
 * at the OLD one, so `GET /repos/:id/context` read an empty/missing
 * directory; (b) when the computed path happened to already be a genuine
 * checkout (`SimpleGitClient` uses this exact `<cloneDir>/<owner>/<repo>`
 * layout for a real clone), every reseed overwrote real working-tree files
 * with fixture content.
 *
 * Pinning this to a fixed, config-independent location under the user's home
 * removes both failure modes: no real clone is ever placed here (a real
 * clone always goes through `cloneDir`), so the only way `repos.clonePath`
 * can equal this path is if a PRIOR seed run set it — see the call site
 * below, which only ever writes when it is also deciding (or has already
 * decided) that this is the repo's clone path.
 */
function contextFixtureRootFor(owner: string, name: string): string {
  return join(homedir(), '.devdigest', 'context-fixtures', owner, name);
}

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

  // ---- L05: Project Context fixture clone ----
  // A directory this seed owns outright (see `contextFixtureRootFor`),
  // written ONLY when it is also becoming — or has already become — this
  // repo's `clonePath`, so the DB pointer and the written location can never
  // drift apart, and a reseed never clobbers a genuine checkout that happens
  // to live somewhere else.
  const contextFixtureRoot = contextFixtureRootFor(repo!.owner, repo!.name);
  if (!repo!.clonePath) {
    await writeContextFixture(contextFixtureRoot);
    await db.update(t.repos).set({ clonePath: contextFixtureRoot }).where(eq(t.repos.id, repoId));
    repo!.clonePath = contextFixtureRoot;
  } else if (repo!.clonePath === contextFixtureRoot) {
    // Already pointing at our own fixture dir from a prior seed run — refresh
    // idempotently (`writeContextFixture` always writes the same content).
    await writeContextFixture(contextFixtureRoot);
  }
  // else: `clonePath` points somewhere else (a real clone) — never touched.

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

  // ---- L05: seeded PR Why + Risk Brief for PR #482 (SPEC-04 step 12) ----
  // A deterministic, pre-generated `pr_brief` row so the e2e flow (plan step
  // 13) has a Why + Risk Brief card to click without ever triggering a model
  // call (`e2e/AGENTS.md` forbids flows that do). `head_sha` matches PR #482's
  // own seeded `headSha` exactly, so the server's staleness check
  // (`pr_brief.head_sha` vs `pull_requests.head_sha`) never marks this row
  // stale. `review_focus[].path` and `risks[].file_refs` only name paths that
  // are actually among PR #482's seeded `pr_files` above (`src/config.ts`,
  // `src/middleware/ratelimit.ts`) — the same grounding rule the real
  // generator enforces (AC-18/AC-20) — and `src/config.ts` is the file the
  // e2e flow expects the diff tab to open on.
  const prWhyBrief: PrWhyBrief = {
    what:
      'Adds a token-bucket rate limiter in front of the public API routes and wires it into the shared request config, touching the webhook and user-list endpoints along the way.',
    why:
      'The public endpoints currently accept unlimited requests from unauthenticated clients; this closes that gap before the next release.',
    risk_level: 'high',
    risks: [
      {
        kind: 'security',
        title: 'Changed file already carries a flagged secret',
        explanation:
          'src/config.ts is touched by this PR and a prior review already flagged a hardcoded Stripe secret key on line 12 of that file — confirm the new lines do not add to that exposure before merging.',
        severity: 'high',
        file_refs: ['src/config.ts'],
      },
      {
        kind: 'reliability',
        title: 'New middleware has no accompanying test file',
        explanation:
          'src/middleware/ratelimit.ts is new in this diff and none of the other changed files is a test for it — the token-bucket edge cases (burst, reset, concurrent requests) are unverified.',
        severity: 'medium',
        file_refs: ['src/middleware/ratelimit.ts'],
      },
    ],
    review_focus: [
      {
        path: 'src/config.ts',
        reason:
          'Already flagged for a hardcoded secret in an earlier review — check whether this PR touches that same region.',
        line: null,
      },
      {
        path: 'src/middleware/ratelimit.ts',
        reason: 'New rate-limiting logic with no test coverage in this diff — review the token-bucket behaviour directly.',
        line: null,
      },
    ],
    inputs: [
      { type: 'intent', ref: null, status: 'unavailable' },
      { type: 'blast', ref: null, status: 'degraded' },
      { type: 'diff', ref: null, status: 'used' },
      { type: 'linked_issue', ref: null, status: 'unavailable' },
    ],
    head_sha: pr!.headSha,
    generated_at: '2026-08-19T12:00:00.000Z',
    model: 'gpt-4.1',
    stale: false,
  };
  await db
    .insert(t.prBrief)
    .values({
      prId: pr!.id,
      json: prWhyBrief,
      headSha: pr!.headSha,
      generatedAt: new Date(prWhyBrief.generated_at),
      model: prWhyBrief.model,
    })
    .onConflictDoNothing();

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

  // ---- L05: seeded run + trace with a non-empty specs_read (Project Context
  // e2e reachability, interview decision Q1) ----
  // Without this row `AC-22`/`AC-23` (the Configuration card's "Specs read"
  // and the Prompt assembly "Project context" section) have nothing to open
  // in e2e — the demo repo's hand-seeded review above has no `agent_runs` row
  // at all. Matched on (pr, agent, source) so a repeated `pnpm db:seed` finds
  // its own fixture run instead of inserting a second one.
  const [generalReviewer] = await db
    .select()
    .from(t.agents)
    .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'General Reviewer')));
  if (generalReviewer && pr) {
    let [fixtureRun] = await db
      .select()
      .from(t.agentRuns)
      .where(
        and(
          eq(t.agentRuns.prId, pr.id),
          eq(t.agentRuns.agentId, generalReviewer.id),
          eq(t.agentRuns.source, 'local'),
        ),
      );
    if (!fixtureRun) {
      [fixtureRun] = await db
        .insert(t.agentRuns)
        .values({
          workspaceId,
          agentId: generalReviewer.id,
          prId: pr.id,
          provider: generalReviewer.provider,
          model: generalReviewer.model,
          durationMs: 4200,
          tokensIn: 1840,
          tokensOut: 410,
          status: 'done',
          source: 'local',
          findingsCount: 2,
          grounding: '2/2 passed',
          score: 61,
          blockers: 1,
          costUsd: 0.004,
        })
        .returning();
    }
    if (fixtureRun) {
      // Only the SPEC-01 pair reaches the demo run's prompt — see
      // `attachedToDemoRun`'s doc comment above `CONTEXT_FIXTURE_FILES`.
      const demoRunFiles = CONTEXT_FIXTURE_FILES.filter((f) => f.attachedToDemoRun);
      const specsRead = demoRunFiles.map((f) => f.relPath);
      const specsBlock = demoRunFiles.map((f) => `### ${f.relPath}\n\n${f.content}`).join('\n\n');
      await db
        .insert(t.runTraces)
        .values({
          runId: fixtureRun.id,
          trace: {
            config: {
              agent: generalReviewer.name,
              version: String(generalReviewer.version),
              provider: generalReviewer.provider,
              model: generalReviewer.model,
              pr: pr.number,
              source: 'local',
            },
            stats: {
              duration_ms: 4200,
              tokens_in: 1840,
              tokens_out: 410,
              cost_usd: 0.004,
              findings: 2,
              grounding: '2/2 passed',
            },
            prompt_assembly: {
              system: GENERAL_REVIEWER_PROMPT,
              skills: null,
              memory: null,
              specs: specsBlock,
              user: `Review PR #${pr.number} — ${pr.title}`,
            },
            tool_calls: [{ tool: 'review_file', args: 'all files', meta: 'single-pass', ms: 4200 }],
            raw_output: 'Solid middleware approach; see findings for details.',
            memory_pulled: [],
            specs_read: specsRead,
            log: [
              { t: '00.00', kind: 'info', msg: `Starting review with agent "${generalReviewer.name}"` },
              // SPEC-01 AC-37/AC-38/AC-44 — the summary line first (both docs
              // are the agent's own, no linked skill in this fixture), then
              // one attributed `attached` line per doc.
              { t: '00.01', kind: 'info', msg: `Project context: ${specsRead.length} doc(s) attached, 0 skipped` },
              { t: '00.01', kind: 'info', msg: `Project context: attached ${specsRead[0]} (agent, ~46 tokens)` },
              { t: '00.01', kind: 'info', msg: `Project context: attached ${specsRead[1]} (agent, ~44 tokens)` },
              { t: '04.20', kind: 'result', msg: `Citation grounding: 2/2 passed` },
            ],
          },
        })
        .onConflictDoNothing();
    }
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
