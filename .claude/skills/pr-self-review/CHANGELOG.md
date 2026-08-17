# Changelog — pr-self-review

`metadata.version` in [SKILL.md](SKILL.md) is the source of truth; the catalog
row in [../README.md](../README.md) carries a matching `vX.Y.Z` badge. Bump both
and add an entry here in the **same commit** as the change.

Semver for this skill:

- **major** — the gate blocks something it used to allow. Flipping
  `mode: report-only` → `blocking` in [routing.md](routing.md) is a major bump,
  because from that moment the skill can stop someone's work.
- **minor** — new checks, new routing entries, new stages that do not newly block.
- **patch** — wording, caps, link fixes, syncing a command with CI.

## 3.0.2 — 2026-08-17

**Stage 2 gates run through `scripts/verify.mjs`.** The four lane commands were
inlined here, in `implementer`, `test-writer`, `plan-verifier` and the
workflows — five copies to keep in step, and every run read the full vitest
output. The script inlines the same workflow commands (still no package
scripts) and prints one line per gate plus the failing gate's tail. Same
commands, same exit codes — a patch. Also adds the `mcp` slice, which the
inline block had never listed.

## 3.0.1 — 2026-08-12

**`mcp/**` routed to the `backend` slice.** The new `mcp/` package (L04, a
local stdio MCP server over the API) had no row in the slice table, so it fell
through to `anything else → meta` and got no skill review at all. It now maps
to `backend` like `reviewer-core/**`, with a note that `fastify-best-practices`
and `drizzle-orm-patterns` legitimately find nothing there — the package has no
Fastify routes or Drizzle schema, only an HTTP client of the existing API.

Patch, by this skill's own policy: a row was added, no rule changed and
nothing that passed before now blocks.

## 3.0.0 — 2026-08-06

**A client-only contract edit is now CRITICAL, not a WARNING.** The two mirror
directions were graded the same, which put the skill in direct conflict with the
gate it claims to mirror: `pr-gate-ci.mjs` fails the build when
`client/src/vendor/shared/**` changes without the server copy, so the old
grading handed out `verdict: PASS` on a branch CI was about to reject — the exact
disagreement [routing.md](routing.md) forbids ("deterministic failures … already
fail CI, so the local gate must not disagree with it").

The other direction is unchanged and stays a WARNING: a type consumed only by
`reviewer-core` legitimately lives in the server copy alone, and CI reports that
one as a note rather than a failure.

Major by this skill's own policy — it blocks something it used to allow.

## 2.0.0 — 2026-08-04

**Auto-invocation removed.** `.claude/settings.json` no longer registers the
PreToolUse hook, so nothing intercepts `gh pr create` — the skill is invoked by
hand. The working hook configuration is parked in
`.claude/settings.json.hook-example`, so arming it is a copy-paste rather than a
rewrite.

Major, by this skill's own policy: it changes whether the skill can stop
someone's work. The direction is the opposite of the usual major bump — it
blocks *less* — but the rule is about the blocking behaviour changing at all,
and prose that lied about it would be worse than either setting.

The hook was never broken. It was verified end to end against a real
`gh pr create` (blocked with no stamp, passed with a valid one, blocked again
once the tree changed). It is unplugged because an automatic gate at the moment
a change is finished is friction, and a gate that annoys gets deleted whole.

CI is untouched: `pr-gate.yml` still runs on every PR, which is the half that a
branch-protection rule can actually hold Merge on.

## 1.0.0 — 2026-08-04

Initial release. Ships in **`report-only`**: findings are reported, nothing is
blocked. See the README for how and when to flip it.

- [SKILL.md](SKILL.md) — six stages: establish the diff (committed + staged +
  unstaged), slice it, run the deterministic gates, review, subtract waivers and
  baseline, then verdict + PR body + stamp.
- [routing.md](routing.md) — slice table derived from the workflow `paths:`
  filters, skill map with the never-routed list and its reasons, the severity
  scale, the mode toggle, and the cost caps.
- [waivers.md](waivers.md) — inline and standing waivers, the mandatory-reason
  rule, the three-strike counter, and the waiver-vs-baseline distinction.
- `scripts/pr-gate-check.mjs` — PreToolUse stamp validator. Verified against the
  full matrix: non-matching command, chained `gh pr create`, missing stamp,
  moved HEAD, dirty tree, BLOCKED verdict, and `report-only` pass-through.
- `scripts/pr-gate-ci.mjs` + `.github/workflows/pr-gate.yml` — the CI half:
  Insights section in the PR body, contract-mirror heuristic, do-not-touch
  paths, and the shrink-only baseline. Each failure path was verified by
  planting a violation.
- `scripts/pr-gate-baseline.json` — empty at adoption.

Design decisions, argued in the README:

- The gate owns the severity scale rather than mapping the three mutually
  incompatible vocabularies the skills use; a CRITICAL must state a production
  consequence.
- Bug-hunting and security are delegated to `/code-review` and
  `/security-review`. The vendored `security` skill is deliberately not routed —
  it targets Express + MongoDB, not this stack.
