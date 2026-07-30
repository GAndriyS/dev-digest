# server — `@devdigest/api`

Fastify API over Drizzle/Postgres: imports repos and PRs, indexes them with
repo-intel, runs the reviewer, persists grounded findings. pnpm.

## Before answering

Read `server/INSIGHTS.md` before starting work; search `server/docs/` and
`server/specs/` as needed.

## Conventions (not obvious from code)

- Module anatomy: `modules/<name>/{routes,service,repository}.ts` — routes
  validate, services own logic, repositories own SQL. Adding a module = a plugin
  in `routes.ts` + one entry in `src/modules/index.ts`. Registration is static
  on purpose: dynamic `import()` of `.ts` is not portable across tsx, the
  bundler, and vitest.
- Declare zod `params`/`body` on the route — invalid input 422s before the
  handler runs. Throw `AppError` for anything with a status.
- Reach adapters only through the DI container — that is what makes
  `src/adapters/mocks.ts` substitution work in tests. Plugins register
  **before** modules so module plugins inherit them.
- Contract changes happen in `src/vendor/shared` (the canonical copy) and must
  be mirrored into `client/src/vendor/shared`.
- Test split: unit = `pnpm exec vitest run --exclude '**/*.it.test.ts'`;
  integration = `pnpm exec vitest run .it.test` (needs Docker). A test that
  imports `test/helpers/pg.ts` must be named `*.it.test.ts`.
- Migrations: `pnpm db:migrate` explicitly, never on boot; a new one via
  `pnpm db:generate`. Never edit applied `src/db/migrations/**`.
- Editing `server/.env` does not restart `pnpm dev` — tsx watches imported
  modules only, and config is read once at boot. Restart by hand.
- Two zod instances exist at runtime (shared vs api), so `instanceof ZodError`
  is unreliable — the error handler shape-matches on purpose. Don't simplify it.
- Stale-run reaping on boot assumes **one API instance per database**.
- The global rate limit is disabled under `NODE_ENV=test`.
- repo-intel degrades silently: an unindexed repo yields empty facade results,
  not an error — the review just loses its context sections.
- `clones/**` is runtime data — never touch it.

## Use when

- API map, request/DI flow, env vars, commands → read `server/README.md`
- Indexer internals → read `server/src/modules/repo-intel/README.md`
- Deep dives → read `server/docs/` · specs → read `server/specs/` · findings →
  read `server/INSIGHTS.md`
