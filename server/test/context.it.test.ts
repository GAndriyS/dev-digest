import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[context] Docker not available — skipping integration tests.');
}

/**
 * L05 — Project Context over a real Postgres and a real (temp) clone. Covers
 * the wire shapes (`ContextListing`, `ContextPaths`), the набірний
 * (set-write) attachment endpoints, and the edge that only a real HTTP round
 * trip can prove: bad wire input 422s BEFORE the handler runs.
 */
d('context module', () => {
  let pg: PgFixture;
  let clonePath: string;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));

    clonePath = await mkdtemp(join(tmpdir(), 'devdigest-context-'));
    for (const [rel, body] of [
      ['specs/overview.md', '# Overview\n\nThe payments API.'],
      ['docs/architecture.md', '# Architecture\n\nSome details.'],
      ['README.md', '# not under a configured root'],
      // Genuinely inside the clone AND `.md` — the two checks `classifyAndRead`
      // had before fix pass 1, item 4. Never offered by the listing (skipped
      // by `SKIP_DIR_NAMES`), so a direct read must be refused too.
      ['node_modules/pkg/README.md', '# vendored'],
      // Fix pass 2, item 2: a root-named segment ANYWHERE in the path
      // (`docs/` here) must not fool the bound — `node_modules` is skipped
      // before `docs` is ever reached, same as the walk.
      ['node_modules/pkg/docs/README.md', '# vendored, nested under docs/'],
      // A real root followed by a SKIP_DIR_NAMES segment: the walk never
      // descends into `node_modules` even from inside a configured root.
      ['docs/node_modules/pkg/README.md', '# vendored, nested under a real root'],
      // SPEC-01 AC-26 — the name rule: matched at the clone root regardless of any
      // configured root (AC-26), and refused when it sits inside a skipped
      // directory, same as the root rule (AC-31).
      ['INSIGHTS.md', '# Root-level insights\n\nMatched by name, not by root.'],
      ['node_modules/pkg/INSIGHTS.md', '# vendored, name matches but must still be refused'],
    ] as const) {
      await mkdir(dirname(join(clonePath, rel)), { recursive: true });
      await writeFile(join(clonePath, rel), body, 'utf8');
    }
  }, 300_000);

  afterAll(async () => {
    await pg?.stop();
    if (clonePath) await rm(clonePath, { recursive: true, force: true });
  });

  let seq = 0;
  async function freshRepo(opts: { cloned?: boolean } = {}): Promise<string> {
    const name = `context-fixture-${seq++}`;
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

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({ config, db: pg.handle.db });
  }

  it('lists the .md files under the configured roots AND by configured name, badged and estimated', async () => {
    const app = await makeApp();
    const repoId = await freshRepo();

    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/context` });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // AC-34: the response body carries the configured file names alongside `roots`.
    expect(body.file_names).toEqual(['INSIGHTS.md']);

    const paths = body.files.map((f: { path: string }) => f.path).sort();
    // `INSIGHTS.md` at the clone root is matched by NAME (AC-26); the same-named
    // file under `node_modules/pkg/` is refused, same as the root rule (AC-31).
    expect(paths).toEqual(['INSIGHTS.md', 'docs/architecture.md', 'specs/overview.md']);
    expect(body.total).toBe(3);
    expect(body.truncated).toBe(false);
    expect(body.roots).toEqual(['specs', 'docs', 'insights']);

    const overview = body.files.find((f: { path: string }) => f.path === 'specs/overview.md');
    expect(overview.root).toBe('specs');
    expect(overview.tokens_est).toBeGreaterThan(0);
    expect(overview.content).toBeNull(); // listing never reads content
    expect(overview.used_by_agents).toBe(0);

    const insights = body.files.find((f: { path: string }) => f.path === 'INSIGHTS.md');
    expect(insights.root).toBe('insights'); // badge = lowercased stem of the CONFIGURED name

    await app.close();
  });

  it('honors a custom PROJECT_CONTEXT_FILES for the same clone (AC-29)', async () => {
    // The same fixture clone also has a `docs/architecture.md` — reuse it as
    // the "custom name" to prove the config seam (not a fixture coincidence)
    // is what drives the extra match.
    const config = loadConfig({
      ...process.env,
      NODE_ENV: 'test',
      PROJECT_CONTEXT_FILES: 'architecture.md',
    } as NodeJS.ProcessEnv);
    const app = await buildApp({ config, db: pg.handle.db });
    const repoId = await freshRepo();

    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/context` });
    const body = res.json();
    expect(body.file_names).toEqual(['architecture.md']);
    // `docs/architecture.md` is still listed once, badged by the ROOT (AC-28) —
    // it matches both the default root rule and this custom name rule.
    const architecture = body.files.find((f: { path: string }) => f.path === 'docs/architecture.md');
    expect(architecture.root).toBe('docs');
    expect(body.files.filter((f: { path: string }) => f.path === 'docs/architecture.md')).toHaveLength(1);
    // `INSIGHTS.md` at the root no longer matches anything (no configured
    // root, and the name rule now points at `architecture.md` instead).
    expect(body.files.some((f: { path: string }) => f.path === 'INSIGHTS.md')).toBe(false);

    await app.close();
  });

  it('previews one document with content', async () => {
    const app = await makeApp();
    const repoId = await freshRepo();

    const res = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/context/doc?path=specs/overview.md`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      path: 'specs/overview.md',
      content: '# Overview\n\nThe payments API.',
      root: 'specs',
    });

    await app.close();
  });

  it('previews a document matched only by configured NAME, at the clone root (AC-32)', async () => {
    const app = await makeApp();
    const repoId = await freshRepo();

    const res = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/context/doc?path=INSIGHTS.md`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      path: 'INSIGHTS.md',
      content: '# Root-level insights\n\nMatched by name, not by root.',
      root: 'insights',
    });

    await app.close();
  });

  it('404s a doc whose NAME matches a configured file name but sits inside a skipped directory (AC-31/AC-32)', async () => {
    const app = await makeApp();
    const repoId = await freshRepo();

    const res = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/context/doc?path=${encodeURIComponent('node_modules/pkg/INSIGHTS.md')}`,
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it('answers 409 when the repo has never been cloned', async () => {
    const app = await makeApp();
    const bareId = await freshRepo({ cloned: false });

    const res = await app.inject({ method: 'GET', url: `/repos/${bareId}/context` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('repo_not_cloned');

    await app.close();
  });

  it('attaches, reorders, and reflects the set on an agent', async () => {
    const app = await makeApp();

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Context Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();

    const empty = await app.inject({ method: 'GET', url: `/agents/${agent.id}/context` });
    expect(empty.json()).toEqual({ paths: [] });

    const set = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/context`,
      payload: { paths: ['docs/architecture.md', 'specs/overview.md'] },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json()).toEqual({ paths: ['docs/architecture.md', 'specs/overview.md'] });

    // Reorder — the whole set is replaced, not merged.
    const reordered = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/context`,
      payload: { paths: ['specs/overview.md'] },
    });
    expect(reordered.json()).toEqual({ paths: ['specs/overview.md'] });

    const get = await app.inject({ method: 'GET', url: `/agents/${agent.id}/context` });
    expect(get.json()).toEqual({ paths: ['specs/overview.md'] });

    // "Used by N agents" on the repo listing reflects the attachment.
    const repoId = await freshRepo();
    const listing = (
      await app.inject({ method: 'GET', url: `/repos/${repoId}/context` })
    ).json();
    const overview = listing.files.find((f: { path: string }) => f.path === 'specs/overview.md');
    expect(overview.used_by_agents).toBe(1);

    await app.close();
  });

  it('attaches to a skill through the same wire shape', async () => {
    const app = await makeApp();
    const skill = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: 'ctx-skill', description: 'd', type: 'custom', source: 'manual', body: 'b' },
      })
    ).json();

    const set = await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/context`,
      payload: { paths: ['docs/architecture.md'] },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json()).toEqual({ paths: ['docs/architecture.md'] });

    const get = await app.inject({ method: 'GET', url: `/skills/${skill.id}/context` });
    expect(get.json()).toEqual({ paths: ['docs/architecture.md'] });

    await app.close();
  });

  it('404s an attachment write for an unknown agent/skill', async () => {
    const app = await makeApp();
    const unknownAgent = await app.inject({
      method: 'POST',
      url: '/agents/00000000-0000-0000-0000-000000000000/context',
      payload: { paths: [] },
    });
    expect(unknownAgent.statusCode).toBe(404);

    const unknownSkill = await app.inject({
      method: 'GET',
      url: '/skills/00000000-0000-0000-0000-000000000000/context',
    });
    expect(unknownSkill.statusCode).toBe(404);

    await app.close();
  });

  it('dedupes a duplicate path in the set-write body instead of 500ing on the PK (fix pass 1, item 1)', async () => {
    const app = await makeApp();
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name: 'Duplicate Path Agent',
          provider: 'openai',
          model: 'gpt-4.1',
          system_prompt: 's',
        },
      })
    ).json();

    const set = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/context`,
      payload: { paths: ['specs/overview.md', 'docs/architecture.md', 'specs/overview.md'] },
    });
    // Before the fix: DELETE committed, then INSERT hit PK (agent_id, path)
    // on the repeated path and rolled back nothing — a generic 500 that also
    // lost the agent's prior attachment set.
    expect(set.statusCode).toBe(200);
    expect(set.json()).toEqual({ paths: ['specs/overview.md', 'docs/architecture.md'] }); // keep-first

    const get = await app.inject({ method: 'GET', url: `/agents/${agent.id}/context` });
    expect(get.json()).toEqual({ paths: ['specs/overview.md', 'docs/architecture.md'] });

    await app.close();
  });

  it('scopes "used by N agents" to the caller\'s workspace (fix pass 1, item 3)', async () => {
    const app = await makeApp();
    const repoId = await freshRepo();

    // Baseline before this test's own workspace-scoped attachment — other
    // `it` blocks in this file share the same seeded default workspace and
    // may already have `specs/overview.md` attached, so the assertion below
    // is a delta, not an absolute count.
    const before = (await app.inject({ method: 'GET', url: `/repos/${repoId}/context` })).json();
    const baseline = before.files.find((f: { path: string }) => f.path === 'specs/overview.md')
      .used_by_agents as number;

    // A second workspace with its OWN agent attached to the same path. The
    // no-auth app's HTTP surface always resolves to the default workspace, so
    // this is wired directly against the DB.
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-workspace-${seq++}` })
      .returning();
    const [otherAgent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId: otherWs!.id,
        name: 'Other Workspace Agent',
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 's',
      })
      .returning();
    await pg.handle.db
      .insert(t.agentContextDocs)
      .values({ agentId: otherAgent!.id, path: 'specs/overview.md', position: 0 });

    const after = (await app.inject({ method: 'GET', url: `/repos/${repoId}/context` })).json();
    const overview = after.files.find((f: { path: string }) => f.path === 'specs/overview.md');
    // Before the fix: the ungrouped count included the other workspace's
    // agent, so this would read `baseline + 1`.
    expect(overview.used_by_agents).toBe(baseline);

    await app.close();
  });

  it('404s a doc read outside every configured root, even though it is genuinely inside the clone (fix pass 1, item 4)', async () => {
    const app = await makeApp();
    const repoId = await freshRepo();

    const res = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/context/doc?path=${encodeURIComponent('node_modules/pkg/README.md')}`,
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  /**
   * Fix pass 2, item 2: the shapes above prove refusal only for the one path
   * with no root-named segment at all. These pin the two shapes a path-segment
   * substring test would have let through — a root name appearing anywhere
   * (`.../docs/README.md`) and a real root followed by a skipped subtree
   * (`docs/node_modules/...`).
   */
  it('404s a doc whose path merely CONTAINS a root-named segment after a skipped directory', async () => {
    const app = await makeApp();
    const repoId = await freshRepo();

    const res = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/context/doc?path=${encodeURIComponent('node_modules/pkg/docs/README.md')}`,
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it('404s a doc under a real root once the path enters a skipped subtree', async () => {
    const app = await makeApp();
    const repoId = await freshRepo();

    const res = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/context/doc?path=${encodeURIComponent('docs/node_modules/pkg/README.md')}`,
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it('422s a wire-invalid path before the handler runs', async () => {
    const app = await makeApp();
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Bad Path Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();

    const traversal = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/context`,
      payload: { paths: ['../secrets.md'] },
    });
    expect(traversal.statusCode).toBe(422);

    const leadingSlash = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/context`,
      payload: { paths: ['/etc/passwd.md'] },
    });
    expect(leadingSlash.statusCode).toBe(422);

    const notMarkdown = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/context`,
      payload: { paths: ['specs/overview.txt'] },
    });
    expect(notMarkdown.statusCode).toBe(422);

    const repoId = await freshRepo();
    const badQuery = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/context/doc?path=${encodeURIComponent('../escape.md')}`,
    });
    expect(badQuery.statusCode).toBe(422);

    await app.close();
  });
});
