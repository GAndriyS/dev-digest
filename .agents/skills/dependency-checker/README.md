# dependency-checker — maintainer notes

Notes for the human changing this skill. The skill itself is [SKILL.md](SKILL.md);
its history is [CHANGELOG.md](CHANGELOG.md).

## The split that makes this skill work

| Part | Owns | Lives in |
|---|---|---|
| Collector | Facts — what is declared, what is installed, what it weighs, what imports it | [`scripts/deps-report.mjs`](../../../scripts/deps-report.mjs) |
| Skill | Judgement — what the facts mean, which tier, in what order, said to whom | `SKILL.md` |

Keep the line where it is. A number the collector cannot produce does not belong
in the prose as an instruction ("estimate the gzip size" — it cannot, so do not
ask). A judgement the collector makes is a judgement nobody can override, which
is why its severities stop at the mechanical ones and the ordering of the final
report is the agent's.

## Changing the report structure

The section names in SKILL.md's Step 4 skeleton are **graded**. The eval set in
`evals/skills/dependency-checker/` checks for a `Scope` section, a fenced
` ```mermaid ` block using `flowchart`, a size table, a `Findings & Priorities`
section using the P0/P1/P2/Info tiers, and a `Summary` with 3–5 prioritised
takeaways. Rename a section and the eval fails — which is the point: the
structure is a contract with the reader, not decoration.

Run after any edit:

```bash
cd evals && pnpm eval:quality dependency-checker
```

The model-backed lane (`pnpm eval:skills`, judged) costs subscription or
OpenRouter budget — run it deliberately, by hand, never as a side effect of
another task.

## Changing the collector

- It is dependency-free on purpose (node builtins only) and must stay runnable
  from a clean checkout with no install of its own.
- Offline by default. Anything that touches the network goes behind a flag.
- It never mutates: no `install`, no `audit fix`, no lockfile writes. A reader
  must be able to run it on a colleague's branch without consequences.
- Import scanning is regex over raw source, so it sees strings in doc comments
  too. Two guards keep that honest: a specifier must be shaped like a package
  name, and a *phantom* dependency must actually exist in `node_modules`. Weaken
  either and the P0 list fills with fixture strings.
- Sizes come from walking the tree with symlinks skipped — that is what makes
  the pnpm store count each version once instead of once per link.

## Known limits (state them, do not paper over them)

- **Disk size ≠ bundle size.** Nothing here measures what reaches the browser;
  `client/` bundle weight needs a real Next.js build. The report says "on disk"
  everywhere for that reason.
- **Unreferenced is a candidate, not a verdict.** Config-driven and
  framework-loaded packages have no import site.
- **One resolution per version.** The tree is keyed by `name@version`, so a
  package resolved differently under two parents is expanded once.
- **`--audit` reports what the registry says today**; it is not a substitute for
  `/security-review` on the code itself.
