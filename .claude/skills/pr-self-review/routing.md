# Routing — slices, skills, severity

The single source of truth for what runs against what. `SKILL.md` describes the
workflow; this file holds the tables it reads.

## Mode

```
mode: report-only
```

`report-only` — findings are reported, the stamp is written with `verdict: PASS`
regardless. This is the adoption setting.
`blocking` — a critical finding writes `verdict: BLOCKED`.

What a `BLOCKED` verdict actually stops depends on the second switch: the
PreToolUse hook is **not registered by default** (see the skill README), so
today a blocked verdict is a loud report and nothing more. Arming the hook from
`.claude/settings.json.hook-example` is what makes it refuse `gh pr create`.
Two independent switches on purpose — "how harshly do I judge" and "does the
judgement stop anything" are different decisions.

Flip to `blocking` once a few real PRs have gone through and the finding quality
is known. Change it here **and** say so in `CHANGELOG.md`.

The mode is copied into the stamp on every run. `scripts/pr-gate-check.mjs`
reads it from the stamp, not from this file, so flipping the mode never
retroactively re-judges a review that was produced under the other one.

## Severity scale — the gate owns this

Skills supply rules; the gate supplies the scale. Three skills in this repo
define their own severity vocabularies and they disagree with each other
(`CRITICAL/HIGH/MEDIUM`, a severity×confidence matrix, `LOW-MEDIUM` compounds);
ten skills define none at all. Mapping between them would be guesswork, so
every subagent classifies against this table instead, whatever the source skill
calls it.

| Severity | Definition | Effect |
|---|---|---|
| **CRITICAL** | Will break production, lose or corrupt data, or open a security hole. A reviewer would say "do not merge this." | Blocks (in `blocking` mode) |
| **WARNING** | Wrong per a repo convention or skill rule, but it ships safely. Architecture and layout violations belong here. | Advisory |
| **SUGGESTION** | Style, polish, opportunistic cleanup. | Advisory |

**To raise CRITICAL, a finding must state the production consequence in
`rationale`.** Without one it is a WARNING. This is the whole defence against a
gate that cries wolf: "violates the layering rule" is not a reason to stop a
merge, and a gate that behaves as if it were will be switched off within a week.

Deterministic failures — typecheck, dependency-cruiser, `check-ui-conventions`,
a failing test — are CRITICAL by construction. They already fail CI, so the
local gate must not disagree with it.

Values on the wire use the runtime enum from
`server/src/vendor/shared/contracts/findings.ts`
(`CRITICAL` / `WARNING` / `SUGGESTION`) so findings can be handed to
`gateTriggered(findings, 'critical')` in `reviewer-core/src/output/to-review.ts`
unchanged.

## Slices

Derived from the `paths:` filters in `.github/workflows/*.yml` — those already
encode the two couplings a top-level-directory split would miss.

| Path | Slice | Notes |
|---|---|---|
| `client/**` | `frontend` | excluding `client/src/vendor/ui/**` |
| `client/src/vendor/shared/**` | `frontend` + `contracts` | trimmed copy; mirror check |
| `server/**` | `backend` | excluding `server/clones/**` and applied `src/db/migrations/*.sql` |
| `server/src/vendor/shared/**` | `backend` + `contracts` | canonical copy; mirror check |
| `reviewer-core/**` | `backend` | server type-checks this source via alias |
| `mcp/**` | `backend` | no Fastify/Drizzle surface in this package — `fastify-best-practices` and `drizzle-orm-patterns` find nothing to say there |
| `e2e/**` | `e2e` | deterministic gates only, no skill review |
| `.claude/**`, `*.md`, `docs/`, `specs/` | `meta` | no skill review |
| anything else | `meta` | listed in the report so nothing is silently ignored |

**Excluded from review entirely** (AGENTS.md "Do not touch"): `server/clones/**`,
`server/src/db/migrations/*.sql`, `**/src/vendor/ui/**`. A diff that *modifies*
them is itself a CRITICAL finding — they are not review targets, they are
tripwires.

**One exception — a declared vendor update.** `**/src/vendor/ui/**` may be
edited in place when the PR body carries a line naming each edited file:

```
Vendor-update: client/src/vendor/ui/nav.ts
```

Then it is not a finding; instead list the declared files in the report so they
reach the reviewer's eye. The declaration does not make the edit correct — "fix
upstream, then re-vendor" is still the rule, and no machine can check that it
was followed. What the line buys is *visibility*: the claim sits in the PR body
next to the diff, where a human can judge it. An **undeclared** edit, or a
declaration naming a directory rather than a file, stays CRITICAL. Clones and
applied migrations have no such exception — no declaration makes editing them
right. `scripts/pr-gate-ci.mjs` enforces exactly this in CI; prose and gate must
not drift.

## Skill map

| Slice | Skills | Condition |
|---|---|---|
| `frontend` | `frontend-ui-architecture`, `react-best-practices`, `next-best-practices` | always |
| `frontend` | `react-testing-library` | only if `*.test.tsx` in the slice |
| `backend` | `onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns` | always |
| `backend` | `postgresql-table-design` | only if `server/src/db/**` in the slice |
| any code slice | `zod` | only if a schema or contract file is in the slice |

**Never routed**, and why — this list matters as much as the one above:

| Skill | Why not |
|---|---|
| `security` | `/security-review` covers this properly. The vendored skill targets Express + MongoDB + Mongoose; this stack is Fastify + Drizzle/Postgres, so its examples do not match the code under review. |
| `typescript-expert` | Checklist-shaped and language-general; high noise against a diff. `/code-review` already covers correctness. |
| `mermaid-diagram`, `engineering-insights` | Authoring skills, not review skills. |

## Delegation

Bug-hunting and security are **not** reimplemented here. Stage 3a runs the
built-ins and ingests their findings:

| Concern | Owner |
|---|---|
| General correctness, bugs | `/code-review` |
| Security | `/security-review` |
| Repo-specific conventions | the subagents above |
| Slicing, routing, verdict, stamp, PR body | this skill |

If a built-in's output cannot be parsed, record `delegate step skipped: <which>`
in the report and continue. A broken delegation must not take the gate down with
it — but it must never pass silently either.

## Cost ceiling

| Limit | Default |
|---|---|
| concurrent subagents | 8 |
| files per subagent | 40 |
| diff lines per subagent prompt | 4000 |

Anything dropped by a cap is listed verbatim in the report. A gate that silently
reviews half a diff is worse than no gate, because it reads as a pass.
