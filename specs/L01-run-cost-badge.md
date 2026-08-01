# L01 — Run cost

## Goal

A review run has a dollar cost, and today that number is computed and then
thrown away. `reviewer-core` already returns `ReviewOutcome.costUsd` — the
provider's reported `usage.cost` when OpenRouter gives one, otherwise the
`PriceBook` estimate — but nothing persists or shows it.

Surface it on the three screens where the question "what did this cost?"
actually gets asked: the PR list (per PR), the agent-runs timeline (per run),
and the run trace drawer (the run you are inspecting).

## Acceptance criteria

- [ ] The PR list has a COST column between STATUS and UPDATED. The value is the
      **total across every agent run** on that PR — the answer to "what has this
      PR cost me?". (Deliberately unlike the SCORE column next to it, which
      shows only the latest review.)
- [ ] A PR with no priced run renders `—`, not `$0.0000`: "never measured" must
      stay distinguishable from "measured, and it was free".
- [ ] The agent-runs timeline shows `<tokens> tok · $<cost>` under each run's
      timestamp, tokens thousands-separated.
- [ ] The trace drawer shows a COST stat between TOKENS and FINDINGS.
- [ ] Cost renders with **fixed 4 decimals** everywhere, from one shared
      `formatCost`. Two decimals would flatten every run on our default cheap
      models (~$0.0002) to `$0.00`.
- [ ] A run that completes after the migration persists `agent_runs.cost_usd`;
      rows written before it stay `NULL` and render `—`, never `$NaN`.
- [ ] Failed and cancelled runs persist no cost — they spent nothing worth
      showing.

## Out of scope

- The **FINDINGS** column visible in the same mockup. Its absence from the PR
  list is deliberate (see the comment in `modules/pulls/routes.ts`); it is the
  other half of L01, "severity filter on findings".
- The Agent Performance / Eval / CI dashboards, which keep their own cost
  aggregates.
- Any change to how cost is *computed*. The pricing catalog (`PriceBook`,
  `adapters/llm/pricing.ts`) is already correct and stays untouched.

## Touched surfaces

- **server** — `db/schema/runs.ts` (`cost_usd` column + migration),
  `modules/reviews/{run-executor,repository,repository/run.repo}.ts`
  (persist), `modules/pulls/routes.ts` (last-completed-run lookup for the list).
- **contracts** — `RunStats`, `RunSummary`, `PrMeta`. Mirror every change into
  **both** copies of `@devdigest/shared` (server canonical → client trimmed).
- **client** — `pulls/{constants,styles}.ts` and `_components/PRRow` (column),
  `RunHistory` (timeline line), `RunTraceDrawer/{helpers,TraceBody}` (stat +
  the shared `formatCost`), `messages/en/{prReview,runs}.json`.
