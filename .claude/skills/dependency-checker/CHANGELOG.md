# Changelog — dependency-checker

All notable changes to this skill and to the collector it depends on
(`scripts/deps-report.mjs`). The two ship together: a rule the prose states must
be a rule the collector can evidence.

## 1.0.0 — 2026-08-24

First version.

**Skill**

- Report contract fixed: **Scope → Dependency graph → Size & weight → Internal
  dependencies → Findings & Priorities → Summary**, with the tiers **P0 / P1 /
  P2 / Info** and a 3–5 item prioritised summary. The structure is what the eval
  set in `evals/skills/dependency-checker/` grades, so changing a section name
  is a breaking change for the evals as well as for the readers.
- Two modes — **measured** (run the collector) and **supplied** (reason over data
  given in the prompt, no tool access). The second exists because the quality
  evals run tool-free, and because a developer pasting a `du -sh` dump deserves
  the same report.
- Internal (path alias) and external (npm) dependencies are separated
  everywhere, and the prose states explicitly that these six packages are **not**
  a workspace — a fix built on `workspace:*` would not work here.
- Rules of evidence: name the package and the file, carry the number, call an
  unimported dependency a *candidate* rather than "unused", and present every
  removal or bump as a proposal to confirm — never as work already done.

**Collector — `scripts/deps-report.mjs`**

- Offline by default: manifests, `pnpm ls` / `npm ls`, and the bytes on disk.
  `--outdated` and `--audit` are opt-in because they hit the registry.
- Measures **exclusive size** per direct dependency (its subtree minus anything
  another root also pulls in) — the number that answers "what do we get back if
  this goes".
- Cross-package view no single lockfile can give: declared-range drift, resolved
  drift between the six lockfiles, and the same library installed N times.
- Hygiene by measurement, not by convention: unreferenced dependencies (with a
  reason — types-only, config-named, framework-loaded, script-run), phantom
  imports that are installed but declared nowhere, tooling sitting in
  `dependencies`, packages running install scripts, and relative imports that
  reach into another package's internals.
- `--fail-on p0` for a future CI lane. Not wired into `scripts/verify.mjs` — this
  is a report, not a gate, until the P0 list is empty and stays that way.
