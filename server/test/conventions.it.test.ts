import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[conventions] Docker not available — skipping integration tests.');
}

/**
 * Conventions extractor over a real Postgres and a real (temp) clone.
 *
 * The point of these tests is the evidence gate and the re-scan contract — that
 * a rule the model invented never reaches the database, and that a user's
 * accept/reject decision survives pressing Re-scan. The model itself is a
 * fixture keyed by schema name, so no network is involved.
 */
d('conventions module', () => {
  let pg: PgFixture;
  let clonePath: string;
  let workspaceId: string;

  const REDIS_FILE = [
    'import { Redis } from "ioredis";',
    'import { config } from "./config";',
    '',
    'export const redis = new Redis(config.redisUrl);',
  ].join('\n');

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));

    clonePath = await mkdtemp(join(tmpdir(), 'devdigest-conventions-'));
    for (const [rel, body] of [
      ['tsconfig.json', '{ "compilerOptions": { "strict": true } }'],
      ['src/lib/redis.ts', REDIS_FILE],
    ] as const) {
      await mkdir(dirname(join(clonePath, rel)), { recursive: true });
      await writeFile(join(clonePath, rel), body, 'utf8');
    }

    // Explicit budget: this hook does everything `startPg` does (which alone can
    // take ~2 min on a cold Docker) plus seeding and laying down a temp clone,
    // so it does not fit the global 120s. Raised here rather than in
    // vitest.config.ts — one slow hook is not a reason to loosen every suite's.
  }, 300_000);

  /**
   * A fresh repo per test, all pointing at the same clone. The extractor's whole
   * subject is accumulated state (pending replaced, decisions kept), so sharing
   * one repo across cases would make each test depend on the previous one's
   * leftovers — and on list ordering — rather than on the behaviour it names.
   */
  let seq = 0;
  async function freshRepo(opts: { cloned?: boolean } = {}): Promise<string> {
    const name = `fixture-${seq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name,
        fullName: `acme/${name}`,
        ...(opts.cloned === false ? {} : { clonePath }),
      })
      .returning();
    return repo!.id;
  }

  afterAll(async () => {
    await pg?.stop();
    if (clonePath) await rm(clonePath, { recursive: true, force: true });
  });

  /** repo-intel is stubbed: sampling is the extractor's input, not its subject. */
  const repoIntel = { getConventionSamples: async () => ['src/lib/redis.ts'] } as unknown as RepoIntel;

  function makeApp(conventions: unknown) {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        repoIntel,
        llm: {
          openrouter: new MockLLMProvider('openai', {
            structuredBySchema: { ConventionExtraction: { conventions } },
          }),
        },
      },
    });
  }

  const grounded = {
    category: 'structure',
    rule: 'Redis access goes through the exported client',
    evidence_path: 'src/lib/redis.ts',
    evidence_snippet: 'export const redis = new Redis(config.redisUrl);',
    confidence: 0.9,
  };
  const invented = {
    category: 'structure',
    rule: 'Mongo access goes through the exported client',
    evidence_path: 'src/lib/redis.ts',
    evidence_snippet: 'export const mongo = new Mongo(config.mongoUrl);',
    confidence: 0.95,
  };

  it('stores grounded candidates with a derived line and drops invented ones', async () => {
    const app = await makeApp([grounded, invented]);
    const repoId = await freshRepo();

    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/extract`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.dropped_no_evidence).toBe(1);
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0]).toMatchObject({
      rule: grounded.rule,
      evidence_path: 'src/lib/redis.ts',
      status: 'pending',
      // Line 4 of the fixture — derived from the file, never sent by the model.
      evidence_line: 4,
    });
    // Config files are sampled alongside the ranked source files.
    expect(body.sampled_files).toContain('tsconfig.json');
    expect(body.sampled_files).toContain('src/lib/redis.ts');
  });

  it('accepts a candidate and keeps it through a re-scan', async () => {
    const app = await makeApp([grounded]);
    const repoId = await freshRepo();
    await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract`, payload: {} });

    const list = await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` });
    const first = list.json()[0];

    const accepted = await app.inject({
      method: 'PUT',
      url: `/conventions/${first.id}`,
      payload: { status: 'accepted' },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ status: 'accepted' });

    // Re-scan proposing the SAME rule again: the accepted row survives and the
    // duplicate is dropped rather than added beside it.
    const rescan = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/extract`,
      payload: {},
    });
    const after = rescan.json();
    expect(after.candidates).toHaveLength(1);
    expect(after.candidates[0]).toMatchObject({ id: first.id, status: 'accepted' });
    // Dropped as a DUPLICATE, not for missing evidence. The wire field means
    // "the model invented this", and the UI says so — a re-scan that correctly
    // re-proposes a known rule must not be reported as a fabrication.
    expect(after.dropped_no_evidence).toBe(0);
  });

  it('replaces pending candidates rather than accumulating them', async () => {
    // The other re-scan tests all move their row out of `pending` first, so
    // `deletePending` never has anything to delete in them. A no-op delete
    // would pass those and duplicate a row on every scan — this is the case
    // that actually exercises it.
    const other = { ...grounded, rule: 'Config is read through the exported config object' };
    const repoId = await freshRepo();
    const app = await makeApp([grounded]);

    await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract`, payload: {} });
    const firstList = (
      await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })
    ).json();
    expect(firstList).toHaveLength(1);
    expect(firstList[0].status).toBe('pending');

    // A different grounded rule: the stale pending row must be gone, not
    // sitting beside the new one.
    const app2 = await makeApp([other]);
    const rescan = await app2.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/extract`,
      payload: {},
    });
    const after = rescan.json().candidates;
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ rule: other.rule, status: 'pending' });

    // And scanning the same rule again still leaves exactly one row.
    const again = await app2.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/extract`,
      payload: {},
    });
    expect(again.json().candidates).toHaveLength(1);
  });

  it('rewords a rule without changing its status', async () => {
    const app = await makeApp([grounded]);
    const repoId = await freshRepo();
    await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract`, payload: {} });
    const first = (
      await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })
    ).json()[0];

    const res = await app.inject({
      method: 'PUT',
      url: `/conventions/${first.id}`,
      payload: { rule: 'Redis access goes through the exported singleton' },
    });
    expect(res.json()).toMatchObject({
      rule: 'Redis access goes through the exported singleton',
      status: 'pending',
      evidence_line: 4,
    });
  });

  it('does not resurrect a rejected rule on the next scan', async () => {
    const app = await makeApp([grounded]);
    const repoId = await freshRepo();
    await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract`, payload: {} });
    const first = (
      await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })
    ).json()[0];

    await app.inject({
      method: 'PUT',
      url: `/conventions/${first.id}`,
      payload: { status: 'rejected' },
    });

    const rescan = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/extract`,
      payload: {},
    });
    const rules = rescan.json().candidates;
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ id: first.id, status: 'rejected' });
    // Duplicate of a rejected rule — again not an evidence failure.
    expect(rescan.json().dropped_no_evidence).toBe(0);
  });

  it('answers 409 when the repo has never been cloned', async () => {
    const app = await makeApp([grounded]);
    const bareId = await freshRepo({ cloned: false });

    const res = await app.inject({
      method: 'POST',
      url: `/repos/${bareId}/conventions/extract`,
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('repo_not_cloned');
  });

  it('422s a patch that changes nothing or misspells a key', async () => {
    const app = await makeApp([grounded]);
    const repoId = await freshRepo();
    await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract`, payload: {} });
    const first = (
      await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })
    ).json()[0];

    const empty = await app.inject({
      method: 'PUT',
      url: `/conventions/${first.id}`,
      payload: {},
    });
    expect(empty.statusCode).toBe(422);

    // The important one: without .strict() this validates, hits the no-op
    // branch and answers 200 — a typo that looks like it worked.
    const typo = await app.inject({
      method: 'PUT',
      url: `/conventions/${first.id}`,
      payload: { staus: 'accepted' },
    });
    expect(typo.statusCode).toBe(422);

    const unchanged = await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` });
    expect(unchanged.json()[0].status).toBe('pending');
  });

  it('404s an unknown repo and rejects a non-uuid id at the edge', async () => {
    const app = await makeApp([grounded]);

    const unknown = await app.inject({
      method: 'GET',
      url: '/repos/00000000-0000-0000-0000-000000000000/conventions',
    });
    expect(unknown.statusCode).toBe(404);

    const bad = await app.inject({ method: 'GET', url: '/repos/not-a-uuid/conventions' });
    expect(bad.statusCode).toBe(422);
  });
});
