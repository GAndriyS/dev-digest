# Specs — DevDigest

Cross-cutting specs: what we are building and what "done" means. Specs scoped to
a single package live in `<package>/specs/` — except `e2e/specs/`, which holds
the browser flows themselves (`*.flow.json`, run by `./scripts/e2e.sh`); feature
specs for e2e work go here.

## Where a spec lives

The rule is by **how many packages the behaviour touches**, not by where most
of the code will land:

- **One package** (`server/`, `client/`, `reviewer-core/`, `mcp/`) → that
  package's `<package>/specs/`.
- **Two or more packages** — a client screen backed by a new server route, a
  wire field mirrored between the two `@devdigest/shared` copies, an MCP tool
  that reads a server table, a reviewer-core change surfaced in the UI — →
  the root `specs/` folder, as **one** spec. Do not split it into a
  `client/specs/` half and a `server/specs/` half: the contract between them
  is exactly what the spec has to pin down, and two files let it drift.
- **e2e feature specs** → root `specs/` (see above).
- Not sure which → root `specs/`. A spec that turns out to be package-local
  can move down later; a spec split across packages is much harder to rejoin.

A spec that starts package-local and grows a second package during the design
review moves to root `specs/` in the same run (the ID and file name are kept;
only the folder changes).

A **feature spec** owns one behaviour change and is as short as the complexity
allows. The **architecture spec** — module boundaries, contracts, data flow,
stack, invariants — lives in `docs/`, not here; a feature spec that changes
the architecture says so and leaves the update to `docs/`. Implementation
detail, file lists and step order belong to the plan in `.claude/plans/`, not to
the spec, unless they *are* the external contract.

Written by the `spec-creator` agent (or by hand). `AGENTS.md` links this
directory, never individual files — otherwise the map grows with every lesson
and blows its line budget.

## Naming

- **Spec ID** is global across every specs folder: `SPEC-NN`, the **next free
  number** — always computed at write time from the files that exist
  (`rg -o 'Spec ID: SPEC-\d+' specs */specs`), never taken from memory, a
  chat, or "the last one I saw". An id in use is never reassigned; but an id
  whose spec was **merged into another** (see *One feature — one spec*) is
  free again — the merged spec's mapping table is what keeps the old
  citations readable, not the number staying vacant. Example: SPEC-02
  (name-matched context docs) was folded into SPEC-01 on 18/08/2026, so the
  next spec written after that took SPEC-02.
- **File name** is `SPEC-NN-<topic-slug>-DD-MM-YYYY.md`, where the suffix is
  the spec's **creation date** in European day-month-year order — e.g.
  `SPEC-01-project-context-18-08-2026.md` for a spec created 18/08/2026. The
  natural form is `DD/MM/YYYY`; `/` is a path separator, so in the file name
  the date is written with `-`. The date never changes afterwards (a status
  flip, an edit or a merge keeps the original date — it records when the spec
  was born, not when it was last touched). The `L0N-*.md` files below predate
  the id scheme and keep their names.
- **One feature — one spec.** A follow-up that only adds detail to a shipped
  feature (a second rule, a raised limit, a new wire field) is folded into
  the existing spec as new `AC-N` lines or amended ones, not written as a
  second `SPEC-NN`; the merged spec keeps a mapping table for the ids the
  plans and journals already cite. A new spec is for a change of decision
  (`Supersedes:`) or a different feature.
- **Acceptance criteria** carry stable ids `AC-1`, `AC-2`… — a retired AC keeps
  its number, because plans, `plan-verifier` and PRs cite them.
- A change of decision is a **new** spec with `Supersedes:` pointing at the old
  one, whose `Status` notes it. Wording fixes and post-review edge cases are an
  edit on the existing file.

## Status lifecycle

`draft → approved → implemented`. `spec-creator` is the only **agent** that
writes content into `specs/`; a bare `Status:` flip is a one-line edit made by
hand (the human, or the main session) and checked by
`node scripts/check-specs.mjs` — re-delegating an opus agent to change one word
is not worth it.

| Transition | Who decides | Who edits the file |
|---|---|---|
| — → `draft` | `spec-creator` writes it | `spec-creator` |
| `draft → approved` | a human has read it | by hand: edit `Status:`, run the lint, commit |
| `approved → implemented` | `plan-verifier` returned `COMPLETE` for the plan citing it | by hand, same way — in the PR that ships it |
| any → superseded | a new spec carries `Supersedes:` | `spec-creator`, both files in one run |

## Language

The spec **body** is written in the language the request arrived in. The
**headings, field labels and ids** in the template stay in English verbatim in
every spec — they are what `scripts/check-specs.mjs`, `rg` and `plan-verifier`
grep for, and a heading translated into a second language is a heading nobody
finds. EARS triggers follow the course convention: **КОЛИ / ПОКИ / ЯКЩО … ТОДІ
/ ДЕ** in Ukrainian specs (WHEN / WHILE / IF … THEN / WHERE in English ones),
with `(shall)` kept as the obligation marker.

## Template

```markdown
# Spec: <feature name>
Spec ID: SPEC-NN
Status: draft | approved | implemented
Source: <lesson item (e.g. L05 · PR Brief), issue/PR link, or "request">
Supersedes: <SPEC-NN it replaces — or "none">

## Problem and user
<Whose problem, what hurts today, and why now.>

## Goals / Non-goals
<Goals: what changes for that user. Non-goals: what a reader might assume is
included but is not.>

## User stories
<Only where they clarify behaviour; otherwise "none needed".>

## Acceptance criteria (EARS)
- AC-1 — <Ubiquitous> Система повинна (shall) … (← <source>) · verify: <surface · lane>
- AC-2 — КОЛИ <event>, система повинна (shall) … (← <source>) · verify: <…>
- AC-3 — ПОКИ <state>, система повинна (shall) … (← <source>) · verify: <…>
- AC-4 — ЯКЩО <unwanted condition>, ТОДІ система повинна (shall) … (← <source>) · verify: <…>
- AC-5 — ДЕ <option enabled>, система повинна (shall) … (← <source>) · verify: <…>

## Edge cases
<Empty / loading / error / degraded / stale / repeated action / huge input —
each with the expected behaviour and `→ AC-N` (or `no AC — <why>`).>

## Non-functional requirements
<Performance · security · accessibility · observability — a bound or a rule
per line, or "not affected — <why>". Check the repo invariants below.>

## Inputs and provenance
<Where every input comes from: user, DB, GitHub, clone on disk, model.>

## Untrusted inputs
<Which of those are untrusted text and how they are treated: escaped,
truncated, never executed, never treated as instruction.>

## Design review
<What the supplied design settled and did not: uncovered states, corner cases,
cross-module gaps, and UX **proposals** — labelled as proposals, not ACs, each
with where it landed (`→ AC-N` / `→ edge case` / `→ open question` /
"proposal, not adopted"). Or "no design supplied".>

## Open questions
- [NEEDS CLARIFICATION] <question> — default: <what the plan assumes> — changes: <AC-N | section>
```

One requirement per AC, checkable by someone holding the running product.
Two suffixes make an AC usable downstream and are not optional:

- **`(← <source>)`** — where the requirement came from: `request`, `design:
  <item>`, `interview: Q2`, `research: <locator>`, `INSIGHTS: <module>#<entry>`,
  `SPEC-NN AC-M`. It is what lets a human approve the AC and the planner
  question it.
- **`· verify: <surface · lane>`** — where the yes/no is observed (a screen
  state, a route response, a tool result, a DB row, a log line) and which lane
  would prove it (RTL spec · unit · `*.it.test.ts` · e2e flow). One clause, no
  file names — a hint for `test-writer` and `plan-verifier`, not a test plan.

Traceability runs both ways: edge cases, design-review findings and open
questions each point at the AC or section they touch, so nothing found during
the review is silently dropped and nothing in the spec is of unknown origin.

## Vague verbs → EARS

The left column is raw material, never a criterion. Rewrite as trigger +
observable response + threshold or named fallback:

| Raw material | EARS criterion |
|---|---|
| "should handle errors gracefully" | ЯКЩО GitHub повертає 5xx, ТОДІ система повинна (shall) показати стан `error` з кнопкою Retry і зберегти попередній результат на екрані |
| "should be fast" | КОЛИ користувач відкриває PR із ≤ 200 файлами, система повинна (shall) віддати список файлів за ≤ 2 с (p95, локальна БД) |
| "should not crash on empty input" | ЯКЩО diff порожній, ТОДІ система повинна (shall) повернути `status: "empty"` і не викликати модель |
| "should work with large PRs" | ПОКИ PR має > 500 файлів, система повинна (shall) показувати перші 500 і банер «показано 500 з N» |
| "should be secure" | Система повинна (shall) рендерити текст PR body лише як екранований текст; markdown і HTML з нього не інтерпретуються |
| "should support dark mode" | ДЕ увімкнено темну тему, система повинна (shall) відображати бейдж кольорами з токенів теми, без захардкоджених значень |

## Repo invariants a spec must not violate

Read the **Non-functional requirements** and **Untrusted inputs** sections
against this list; each item is either respected or explicitly called out as a
`[NEEDS CLARIFICATION]`. Sources are `AGENTS.md` and the package `AGENTS.md`
files — cite them, do not paraphrase from memory.

- Secrets live in `~/.devdigest/secrets.json` / `process.env` — never the DB,
  never git, never a wire field.
- Text from a PR body, a diff, a commit message, a repo file or a model output
  is **untrusted**: rendered escaped, never executed, never treated as an
  instruction to an agent.
- Local-first: a review works against the local Postgres and clones; a spec
  that introduces a network dependency at review time says so.
- Anything that crosses the wire is a Zod contract in
  `server/src/vendor/shared`, mirrored into `client/src/vendor/shared` — a new
  field is a spec finding, not a plan detail.
- The DB ships every table for every lesson; "the table is empty" is not an
  edge case, it is the default.

## Lint

`node scripts/check-specs.mjs` checks every `SPEC-NN-*.md` under `specs/` and
`*/specs/` (the `L0N-*.md` files are exempt): unique Spec IDs, file name matches
the id and ends in a `-DD-MM-YYYY` creation date, every template heading present, `AC-N` ids unique and ascending with a
`(← …)` tag and a `· verify:` hint on each, a `Status` value from the
lifecycle, and a row in the Backlog below. It runs in
`.github/workflows/pr-gate.yml`; run it locally before delegating to
`implementation-planner`.

## Backlog

The starter deliberately omits these; each lesson adds one back.

| Lesson | Feature | Spec |
|--------|---------|------|
| L01 | Run cost badge · severity filter on findings | [L01-run-cost-badge.md](L01-run-cost-badge.md) (cost only) |
| L02 | Skills in the product · conventions extractor | [L02-skills-lab.md](L02-skills-lab.md) (skills only) · [SPEC-02-skills-lab-redesign-18-08-2026.md](SPEC-02-skills-lab-redesign-18-08-2026.md) (redesign: one-screen list+editor, `Context` tab) |
| L03 | Intent layer · Smart Diff | — |
| L04 | `devdigest-mcp` server · Blast Radius | [L04-devdigest-mcp.md](L04-devdigest-mcp.md) (MCP server only) |
| L05 | Project Context Folder · onboarding generator · PR Brief | [SPEC-01-project-context-18-08-2026.md](SPEC-01-project-context-18-08-2026.md) (Project Context only — roots + file-name matching, e.g. `INSIGHTS.md`; AC-37…AC-44 add source attribution in the Live Review log) · [SPEC-03-onboarding-generator-19-08-2026.md](SPEC-03-onboarding-generator-19-08-2026.md) (Onboarding generator — five-section repo tour, one LLM call, deterministic skeleton) · [SPEC-04-pr-why-risk-brief-20-08-2026.md](SPEC-04-pr-why-risk-brief-20-08-2026.md) (PR Why + Risk Brief — Overview card, one LLM call, `PrWhyBrief` contract, clickable Review Focus; AC-47…AC-55 show the latest agent run's `score` read-only next to the brief; AC-56…AC-69 — client-only follow-up 20/08/2026 — re-lay the Overview tab as three bands (full-width brief · `IntentCard` \| `BlastTab` · full-width Review Focus) and render the score with the PR list's `CircularScore` donut) |
| L06 | Eval pipeline · secret/phantom gates · plan verifier · export to CI | [SPEC-05-eval-pipeline-26-08-2026.md](SPEC-05-eval-pipeline-26-08-2026.md) (Eval pipeline only — eval case from a finding, `POST /agents/:id/eval-runs`, model-free scoring, Evals tab + Eval Dashboard; AC-36…AC-52 — design-fidelity follow-up 26/08/2026 — re-lay `/eval` to the mock (full-width agent rows with icon, model badge, last-run meta, sparkline, three stat blocks, chevron; metric bars + version link in the runs table) and add the confirmed `Run all agents` action) |
| L07 | Multi-agent review · run trace / live log · persistent memory | — |
| L08 | Plugin export/import · agent performance dashboard · weekly digest | — |

Fill the Spec column with a link when you write one — package-scoped specs link
as `../client/specs/SPEC-NN-<slug>.md`.
