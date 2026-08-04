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
