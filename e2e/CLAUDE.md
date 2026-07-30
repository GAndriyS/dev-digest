# e2e — `@devdigest/e2e`

Deterministic browser flows driven by Vercel **agent-browser** (Rust + CDP).
No Playwright, no LLM, no API key. npm.

## Before answering

Read `e2e/INSIGHTS.md` before starting work; search `e2e/docs/` as needed.
⚠️ `e2e/specs/` holds the flows themselves (`NN-name.flow.json`), not feature
specs — those go in `specs/`.

## Conventions (not obvious from code)

- npm, not pnpm — this package has `package-lock.json`.
- A flow is a JSON list of agent-browser commands run in order against one
  shared session by `run.ts`. `wait --url` / `wait --text` **are** the
  assertions — they time out and exit non-zero if the condition never holds.
- Deterministic locators only: `--url`, `--text`, `find role|text|label`. Never
  the AI `chat` command; runs must stay stable and key-free.
- Flows target read-only seeded data, so nothing ever triggers a model call.
  Keep it that way.
- Flows 02/04/05 follow the home redirect to the **first** repo, so they assume
  the seeded demo repo is the only one. Against a dev DB with other imported
  repos they fail — run `./scripts/e2e.sh` (hermetic seeded stack), not
  `npm test` against your dev database.

## Use when

- Flow format, run instructions, coverage table → read `e2e/README.md`
- Adding a flow → read `e2e/specs/README.md`
- Deep dives → read `e2e/docs/` · findings → read `e2e/INSIGHTS.md`
