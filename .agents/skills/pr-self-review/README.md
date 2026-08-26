# pr-self-review — maintainer notes

For humans maintaining this skill. The agent reads `SKILL.md`; you read this.

## What it is

Three parts that must stay in sync:

1. **`SKILL.md` + `routing.md`** — the review workflow and its tables.
2. **`scripts/pr-gate-check.mjs`** — the stamp validator. Reviews nothing;
   answers "is there a fresh passing review for exactly this tree?" in
   milliseconds. **Not wired up by default** — see "Invocation" below.
3. **`scripts/pr-gate-ci.mjs` + `.github/workflows/pr-gate.yml`** — the CI half,
   because a local hook cannot hold GitHub's Merge button.

## Files

| File | Audience | Contents |
|---|---|---|
| `SKILL.md` | agent | The six-stage workflow |
| `routing.md` | agent + human | Slices, skill map, severity scale, mode, caps |
| `waivers.md` | agent + human | How to waive, the ledger, three-strike rule |
| `README.md` | human | This file |
| `CHANGELOG.md` | human | Version history |

## The two design decisions worth defending

**The gate owns the severity scale.** Three skills in this repo define severity
and disagree with each other; ten define none. Mapping between vocabularies is
guesswork, so subagents classify against one table in `routing.md` regardless of
what the source skill calls its levels. The load-bearing part is the rule that a
CRITICAL must state a production consequence — without it, "violates the
layering convention" would block merges, and the gate would be gone in a week.

**It delegates rather than reimplements.** `/code-review` and `/security-review`
already exist in the harness. This skill orchestrates, routes and decides; they
find bugs. That is also why the vendored `security` skill is not routed: it
assumes Express + MongoDB + Mongoose, and this stack is Fastify +
Drizzle/Postgres, so its examples do not match the code under review.

## Invocation — manual, on purpose

`.claude/settings.json` ships with **no hooks**. `/pr-self-review` is run by
hand; nothing intercepts `gh pr create`.

The first version did wire a PreToolUse hook, and it worked — verified end to
end against a real `gh pr create`. It was removed because an automatic gate at
the moment a change is finished is friction, and the first time it is wrong at
an inconvenient hour it gets deleted outright, value and all. Manual invocation
keeps it a tool rather than a toll.

To arm it for a team that wants it enforced, copy the `hooks` block from
`.claude/settings.json.hook-example` into `.claude/settings.json`. That file
exists precisely so the working configuration is not lost, only unplugged.
Record the switch in `CHANGELOG.md` — it changes whether this skill can stop
someone's work.

CI is unaffected: `.github/workflows/pr-gate.yml` runs on every PR regardless of
local settings, and it is the half a branch-protection rule can hold Merge on.

## Turning the blocking verdict on

It ships in **`report-only`**. Nothing is blocked; the report says what would
have been. Run it on a few real PRs first, read the findings, and only then set
`mode: blocking` in `routing.md` — with a CHANGELOG entry, because that is the
one setting that decides whether the skill can stop someone's work.

The mode is copied into the stamp on each run and the validator reads it from
there, so flipping the mode never retroactively re-judges an existing review.

## Making the Merge button obey

The local hook is honour-based; branch protection is not. Make these required
checks on `main` (repo-admin action, not something this skill can do):

```bash
gh api -X PUT repos/:owner/:repo/branches/main/protection/required_status_checks \
  -f strict=true \
  -f 'contexts[]=conventions' \
  -f 'contexts[]=tests' \
  -f 'contexts[]=typecheck' \
  -f 'contexts[]=browser flows'
```

`conventions` is this workflow's job name; the rest are the existing suites.
Verify the exact context strings against a real PR's checks list first — GitHub
matches them literally, and a typo yields a check that is required and never
reported, which blocks every PR forever.

## Hook caveat on first install

Claude Code only watches directories that already had a settings file when the
session started. `.claude/settings.json` is new here, so in the session that
created it the hook may not fire yet. Open `/hooks` once, or restart the
session. It is live from the next session either way.

## Changing the skill

One PR, all of it:

1. `SKILL.md` / `routing.md` — the workflow or the tables
2. the scripts, if the contract with the stamp changed
3. `CHANGELOG.md` + `metadata.version` in the `SKILL.md` frontmatter
4. the `vX.Y.Z` badge in the catalog row of `.claude/skills/README.md`

Semver: **major** — the gate blocks something it used to allow (including
`report-only` → `blocking`); **minor** — new checks, new routing, new stages
that do not newly block; **patch** — wording, caps, link fixes.

After changing a rule, verify it still bites: plant a violation, confirm the
rule name in the output, remove it. A clean run proves nothing on its own —
that lesson is in the root `INSIGHTS.md`, and it was learned here.

## Deliberate omissions

- **No LLM review in CI.** Every workflow in this repo is `contents: read` with
  no secrets, and adding an `OPENROUTER_API_KEY` is a decision about cost and
  supply chain, not a detail. `reviewer-core` is already shaped for it —
  `reviewPullRequest` takes a parsed diff plus resolved skill *bodies* with no
  DB coupling, and `parseUnifiedDiff` in
  `server/src/adapters/git/diff-parser.ts` is a pure function. A thin `tsx` CLI
  over those two plus `OpenRouterProvider` is the whole of phase 2 — the
  "Export-to-CI" path the codebase already anticipates.
- **No PR comments.** No workflow here has `pull-requests: write`. Findings live
  in `.claude/reviews/` and in the drafted PR body.
- **No auto-fix.** Applying fixes and gating the same change in one pass makes
  the verdict untrustworthy. Fix, then re-run.
