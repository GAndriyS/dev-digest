# reviewer-core — `@devdigest/reviewer-core`

The review engine: diff → prompt → LLM → grounded findings. Shared by the studio
server and the CI runner. npm.

## Before answering

Read `reviewer-core/INSIGHTS.md` before starting work; search
`reviewer-core/docs/` and `reviewer-core/specs/` as needed.

## Conventions (not obvious from code)

- **The iron rule: no database, no GitHub, no filesystem.** The only side effect
  is an LLM call through an *injected* `LLMProvider` — that is what makes the
  engine mock-testable and shareable between the server and the CI runner. Need
  I/O? It belongs in the caller. New inputs arrive as resolved strings — skill
  *bodies*, not slugs; spec *chunks*, not paths.
- npm, NOT pnpm — this package has `package-lock.json`. `npm run typecheck`
  doubles as the build; the package never emits JS.
- Grounding is mandatory: a finding whose lines do not intersect a real diff
  hunk is dropped, and the score is recomputed from the survivors. The model's
  self-reported score is ignored.
- Injection defense is **one shared rule** — `INJECTION_GUARD` in `prompt.ts`.
  Never add keyword scanning of untrusted text (a denylist catches one phrasing
  in one language). Wrap anything external with `wrapUntrusted()`.
- Empty prompt slots (`skills`, `memory`, `specs`, `callers`, `repoMap`) render
  no section at all. Preserve that contract when adding a slot.

## Use when

- Pipeline, public API, commands → read `reviewer-core/README.md`
- Deep dives → read `reviewer-core/docs/` · specs → read `reviewer-core/specs/`
  · findings → read `reviewer-core/INSIGHTS.md`
