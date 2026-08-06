# Examples

Good/bad pairs from this codebase. Every "good" side is real code.

## 1. Routes delegate; they do not query

The route is transport: parse, call, map the status code.

```ts
// ✅ server/src/modules/repos/routes.ts
export default async function reposRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new RepoService(app.container);

  app.post('/repos', { schema: { body: RepoInput } }, async (req, reply) => {
    const { workspaceId, userId } = await getContext(app.container, req);
    const { repo, created } = await service.add(workspaceId, userId, req.body.url);
    reply.status(created ? 201 : 200);
    return repo;
  });
}
```

```ts
// ❌ SQL at the edge — no seam, no reuse from a job, untestable without HTTP
app.post('/repos', { schema: { body: RepoInput } }, async (req) => {
  const [existing] = await app.container.db
    .select().from(t.repos)
    .where(eq(t.repos.fullName, parseRepoUrl(req.body.url).fullName));
  if (existing) return existing;
  // ...
});
```

Caught by `routes-through-service`.

## 2. The service takes resolved values, not the request

```ts
// ✅ server/src/modules/repos/service.ts
export class RepoService {
  private repo: RepoRepository;
  constructor(private container: Container) {
    this.repo = new RepoRepository(container.db);
  }
  async add(workspaceId: string, userId: string, url: string) { /* ... */ }
}
```

```ts
// ❌ Fastify has leaked two rings inward. This service can never run in a job.
export class RepoService {
  async add(req: FastifyRequest<{ Body: { url: string } }>) {
    const workspaceId = req.headers['x-workspace-id'] as string;
    // ...
  }
}
```

Caught by `service-stays-http-agnostic`.

## 3. Depend on the port; let the container build the adapter

```ts
// ✅ the interface is named, the instance is resolved
import type { GitHubClient } from '@devdigest/shared';

const gh: GitHubClient = await this.container.github();
const pulls = await gh.listPullRequests(ref);
```

```ts
// ❌ the service now owns a network client and a secret lookup
import { OctokitGitHubClient } from '../../adapters/github/octokit.js';

const token = process.env.GITHUB_TOKEN!;
const gh = new OctokitGitHubClient(token);
```

Caught by `no-direct-adapter-clients`. The second version also cannot be
substituted by `adapters/mocks.ts`, so every test of it needs the network.

## 4. Adding a new port — all four steps

Skipping any one of them breaks the testing seam.

```ts
// 1. port — server/src/vendor/shared/adapters.ts (canonical copy)
export interface Notifier {
  send(channel: string, message: string): Promise<void>;
}

// 2. adapter — server/src/adapters/notifier/slack.ts
export class SlackNotifier implements Notifier {
  constructor(private token: string) {}
  async send(channel: string, message: string): Promise<void> { /* ... */ }
}

// 3. composition root — server/src/platform/container.ts
export interface ContainerOverrides {
  notifier?: Notifier;
}
async notifier(): Promise<Notifier> {
  if (this.overrides.notifier) return this.overrides.notifier;
  if (this._notifier) return this._notifier;
  const token = await this.secrets.get('SLACK_TOKEN');
  if (!token) throw new ConfigError('SLACK_TOKEN is not configured');
  this._notifier = new SlackNotifier(token);
  return this._notifier;
}

// 4. mock — server/src/adapters/mocks.ts
export class MockNotifier implements Notifier {
  readonly sent: Array<{ channel: string; message: string }> = [];
  async send(channel: string, message: string) { this.sent.push({ channel, message }); }
}
```

Mirror the interface into `client/src/vendor/shared` if it crosses the wire.

## 5. Cross-module reach

```ts
// ✅ shared state lives on the container
const runs = await this.container.agentsRepo.listRuns(workspaceId);

// ✅ another module's constants are its published surface
import { INDEX_JOB_KIND, REFRESH_JOB_KIND } from '../repo-intel/constants.js';
```

```ts
// ❌ another module's repository/service/helpers are private
import { RepoIntelRepository } from '../repo-intel/repository.js';
import { normalizeRef } from '../repo-intel/helpers.js';
```

Caught by `no-cross-module-internals`. If two modules need the same repository,
promote it to a container getter — that is why `agentsRepo` and `reviewRepo`
live there.

## 6. Infrastructure points inward, never outward

```ts
// ❌ server/src/adapters/astgrep/index.ts
import { SUPPORTED_EXT } from '../../modules/repo-intel/constants.js';
```

An adapter is the outermost ring; it must not know a module exists. The fix is
to move the constant into `platform/` or `vendor/shared` and have both sides
import it from there. This exact pair is currently grandfathered in the
dependency-cruiser config — do not use it as precedent.

Caught by `infrastructure-points-inward`.

## 7. reviewer-core takes resolved data, not sources

```ts
// ✅ the caller did the I/O; the core got strings
const review = await reviewPullRequest({
  diff,
  skills: skillBodies,   // bodies, not slugs
  specs: specChunks,     // chunks, not paths
  llm: await container.llm('openrouter'),
});
```

```ts
// ❌ the core would have to read a file and hit the database
import { readFileSync } from 'node:fs';
const body = readFileSync(skillPath, 'utf8');
```

Caught by `core-has-no-io`. The rule also blocks `drizzle-orm`, `postgres`,
`fastify`, `octokit` and `simple-git` inside `reviewer-core/src`.

## 8. Validation belongs on the route, once

```ts
// ✅ one schema, validated before the handler runs (invalid input 422s)
app.get('/repos/:id/pulls', { schema: { params: IdParams } }, async (req) => {
  return service.listPulls(req.params.id); // req.params.id is already typed + parsed
});
```

```ts
// ❌ hand-rolled parsing inside the handler: wrong status code, no serialization
app.get('/repos/:id/pulls', async (req) => {
  const { id } = IdParams.parse(req.params); // throws a 500, not a 422
  return service.listPulls(id);
});
```

Not machine-checkable — this one is on you.

## 9. Testing seam: override the port, do not mock the module

```ts
// ✅ substitute at the boundary the architecture already provides
const container = new Container(config, db, {
  github: new MockGitHubClient({ pulls: [fixture] }),
  llm: { openrouter: new MockLLMProvider(reviewFixture) },
});
```

```ts
// ❌ couples the test to the import graph; breaks when a file moves
vi.mock('../../adapters/github/octokit.js', () => ({ /* ... */ }));
```
