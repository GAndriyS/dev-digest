# Plan: Project Context source attribution in the Live Review log (SPEC-01 AC-37…AC-44)

**Branch:** L05-SDD · **Slices:** backend · **Spec:** specs/SPEC-01-project-context-18-08-2026.md (approved — the AC-37…AC-44 group approved 19/08/2026) · **Mode:** single-agent · **Supersedes:** none

Related, not superseded: `.claude/plans/l05-sdd-project-context.md` (AC-1…AC-36, shipped).
This plan covers **only** AC-37…AC-44; AC-1…AC-36 are implemented and are not re-planned.

## Context read

Binding rules, with locators:

- Root `AGENTS.md:31-33` — contracts are Zod-first, one schema drives validation and
  serialization. **Not exercised here**: NFR *Contracts (атрибуція)* fixes that this group
  changes nothing on the wire.
- Root `AGENTS.md:24-28` — `@devdigest/shared` exists twice; a wire-crossing change edits
  both copies in one step. `RunLogLine { t, kind, msg }`
  (`server/src/vendor/shared/contracts/trace.ts:13-18`) and `RunTrace.specs_read` stay as they
  are, so **neither copy is touched** (spec NFR *Contracts (атрибуція, AC-37…AC-44)*).
- Root `AGENTS.md:34-35` — DB-backed tests must end in `.it.test.ts`; the lanes split on that
  glob. Mirrored in `server/AGENTS.md:25-27`.
- Root `AGENTS.md:18-22` — `server/` uses **pnpm**; five independent packages.
- `server/.dependency-cruiser.cjs:83-97` `no-cross-module-internals` — another module's
  `service.ts` / `repository.ts` / `helpers.ts` are private; **only** `constants.ts`, `types.ts`,
  `index.ts` are its published surface. `run-executor.ts:12` already imports
  `../context/constants.js` legally; the new `ContextDocSource` type therefore has to live in
  `server/src/modules/context/types.ts`, never in `context/helpers.ts`.
- `.claude/skills/onion-architecture/SKILL.md` § Testing seams — a pure function needs no
  container; if a test reaches for one, the logic belongs in `helpers.ts`. This is why the
  attribution merge and the log-line formatting are planned as pure helpers (AC-39/AC-41/AC-42
  are spec'd as `unit` verification).
- `.claude/skills/pr-self-review/routing.md:69` — `server/**` ⇒ slice `backend`;
  `routing.md:105-107` — backend always routes `onion-architecture`,
  `fastify-best-practices`, `drizzle-orm-patterns`; `postgresql-table-design` only when
  `server/src/db/**` is in the slice (the seed edit puts it there); `zod` only when a schema or
  contract file is in the slice — **none is**, so `zod` is not routed.
- `server/INSIGHTS.md:220-231` (2026-08-18, Recurring Errors) — an integration test that does
  `waitForPrRuns(...)` then reads the trace is load-sensitive: `completeAgentRun` runs ~50 lines
  before `saveRunTrace`, so `trace.log` can read as the route's row-shaped default. Every new
  AC-37/AC-38 assertion on `trace.log` inherits this race; wait for the `run_traces` row, do not
  retry the assertion.
- `server/INSIGHTS.md:192-202` (2026-08-11) — `pnpm exec depcruise` dies under Node 18 with a
  `styleText` error; `nvm use 22` before any verification pass.
- `server/INSIGHTS.md:48-59` (2026-08-18) — a pure function that restates another site's rule
  drifts from it, and a fixture that only carries the accepted shapes hides the drift. Applies
  directly: the new attribution must be *derived from* the same merge that produces `specsRead`
  (AC-43), not a second restatement of "agent first, then skills".
- `.github/workflows/server-unit.yml` / `server-integration.yml` — the two lanes this change
  must pass; `scripts/verify.mjs:115-131` inlines both (`backend`, `integration`). No drift
  found between them for these lanes; the integration lane needs Docker and spins its own
  Postgres via testcontainers (it does **not** use the running `devdigest-postgres` container).

Current behaviour being changed:

- `server/src/modules/reviews/run-executor.ts:255-280` — `resolveForRun(repo.clonePath, agent.id,
  linkedSkills.map(l => l.skill.id))`, then one flat `Project context: attached <path> (~N tokens)`
  line per entry and `Project context: skipped <path> — <reason>` per skip. No summary line.
- `server/src/modules/context/service.ts:295-351` — `ownPaths` + `skillPathLists` merged by
  `dedupeKeepFirst` (`helpers.ts:106-115`) at `:320`; after that line the source is unrecoverable.
  Skill lookup failures produce the pseudo-path `(skill <id> context)` (`:311-316`).
- `server/src/modules/context/types.ts:3-20` — `SkippedContextDoc { path, reason }` and
  `ResolvedContextDocs { specs, specsRead, skipped }`; the facade signature is `:66-70`.
- `server/src/db/seed.ts:595-600` — two flat `attached` lines, no summary line;
  `prompt_assembly.skills = null` in the same fixture.
- `server/test/skills-run-path.test.ts:98-100` — hand-rolled `projectContext.resolveForRun` stub
  behind `as unknown as Container`; a shape change here is **invisible to tsc**.

## Requirements review

Every AC of the group, verbatim (Ukrainian, as in the spec), plus the 19/08 edge cases and the
NFR bullets the delegation named.

| # | Requirement (verbatim) | Verdict | How the plan handles it |
|---|------------------------|---------|-------------------------|
| AC-37 | «КОЛИ стартує прогон агента, система повинна (shall) записати в лог прогону рівно один підсумковий рядок про Project Context — `Project context: <N> doc(s) attached, <M> skipped` — до виклику моделі й перед рядками про окремі документи, у тому самому стилі, що сусідні рядки repo-intel …; рядок пишеться завжди, у тому самому форматі, навіть коли `N = 0` і `M = 0`, і видимий і в панелі Live Review під час прогону, і в збереженому `RunTrace.log` після нього.» | clear | Step 3 emits the summary from `runLog.info` immediately after `resolveForRun` returns and **before** the per-doc loop; `RunLogger.event` (`platform/run-logger.ts:50-53`) publishes to the SSE bus and the trace buffer in one call, so "live and stored" is one write. Steps 5, 6. |
| AC-38 | «КОЛИ документ потрапив у промт, система повинна (shall) записати про нього рядок, який називає джерело одразу після шляху — `Project context: attached <path> (agent, ~N tokens)` … `Project context: attached <path> (via skill <name> v<version>, ~N tokens)` …, де `<name>` і `<version>` ті самі, що в рядку `Skills: … <name> v<version>` того ж прогону …, і зафіксовані на момент прогону.» | clear | Steps 1–3: name+version travel **in** from `run-executor`'s already-computed `linkedSkills` (`run-executor.ts:225-235`), the same objects the `Skills:` line is built from — one source, fixed at run time. |
| AC-39 | «ДЕ той самий шлях прикріплено більш ніж до одного джерела …, система повинна (shall) записати про нього рівно один рядок і приписати його ПЕРШОМУ джерелу в порядку AC-18, не повторюючи документ під рештою джерел.» | clear | Step 1: the attribution helper is keep-**first** by path over `[own…, skill₁…, skill₂…]`, the same order `dedupeKeepFirst` consumes. Unit test (step 5) + it-test (step 6). |
| AC-40 | «ЯКЩО скіл вимкнено (`enabled = false`), ТОДІ система повинна (shall) не згадувати його документи в логу взагалі — ні як вкладені, ні як пропущені — і не рахувати їх у жодному з лічильників рядка AC-37.» | clear | No code change needed: `run-executor.ts:225-227` filters on `enabled` before the facade call, so a disabled skill never enters the resolution. Step 3 must keep passing the **filtered** list; step 6 pins it with a regression it-test. |
| AC-41 | «КОЛИ документ пропущено, система повинна (shall) записати рядок `Project context: skipped <path> (<джерело>) — <причина>` … незмінними лишаються префікси `Project context: attached ` і `Project context: skipped `, на які вже спираються тест і демо-фікстура …» | clear | Step 3 formats the skip line with the source segment inserted before the reason and the reason left last; the two prefixes are asserted byte-for-byte in step 5 and are already asserted at `server/test/reviews.it.test.ts:406`. |
| AC-42 | «ЯКЩО не вдалося прочитати сам набір прикріплень (псевдошляхи `(agent context)` / `(skill <id> context)` …), ТОДІ система повинна (shall) назвати джерело в рядку так само, як в AC-38 — іменем і версією скіла, а не самим лише ідентифікатором, — і довести прогін до кінця.» | ambiguous — default taken, see Decisions taken | Two readings: (a) keep the pseudo-path text and let the new `(via skill <name> v<version>)` segment carry the name, (b) also rewrite the pseudo-path to drop the UUID. Plan takes (a) — additive, nothing that reads the pseudo-path changes; (b) is a Recommendation. Either satisfies "not the identifier alone". |
| AC-43 | «Система повинна (shall) виводити джерело кожного документа з тієї самої резолюції, що заповнює `RunTrace.specs_read` (AC-22), без другого звернення до БД чи диска, так що склад і порядок шляхів у рядках AC-38 і в `specs_read` того самого прогону збігаються завжди.» | clear | Steps 1–2: the source rides **on** the resolution result; `specsRead` stays the array the trace is filled from. No new repository or filesystem call is added anywhere (checked in review: `resolveForRun` is the only caller of `agentDocPaths`/`skillDocPaths` on the run path). Unit + it-test parity assertions (steps 5, 6). |
| AC-44 | «Система повинна (shall) писати в демо-фікстуру сидера рядки логу Project Context у форматі AC-37 і AC-38 (підсумковий рядок плюс рядки з атрибуцією), лишаючись ідемпотентною щодо повторного сидінгу.» | clear (its e2e half → Recommendation) | Step 7 rewrites `seed.ts:595-600`; idempotency is unchanged (`.onConflictDoNothing()`, `seed.ts:603`). Verified by an it-test in `test/context.it.test.ts` (it already runs the real `seed()`), plus the manual `pnpm db:seed` check. The AC's `+ e2e flow` half is **out of scope** by the caller's server-only decision — see Recommendations §3 and Open questions. |
| Edge (19/08) | «Один документ прикріплено і до агента, і до успадкованого скіла → … у логу — один рядок із джерелом `agent`.» | clear | AC-39 path, own-first ordering. Unit test (step 5). |
| Edge (19/08) | «Той самий документ прикріплено до двох увімкнених скілів → один рядок логу, джерело — перший скіл у порядку скілів.» | clear | Same helper, same test. |
| Edge (19/08) | «Скіл вимкнено (`enabled = false`) → його документи не успадковуються … і в логу не згадуються жодним рядком, зокрема й серед пропущених.» | clear | AC-40, step 6. |
| Edge (19/08) | «Увімкнений скіл без жодного прикріпленого документа → жодного рядка про цей скіл; підсумковий рядок друкується як завжди.» | clear | Falls out of the design: lines describe documents, never skills. Asserted implicitly by the zero-attachment it-test (step 6). |
| Edge (19/08) | «Ні агент, ні його увімкнені скіли не мають прикріплень → рівно один рядок `Project context: 0 doc(s) attached, 0 skipped`; секція `## Project context` не рендериться …» | clear | Step 3 writes the summary unconditionally; `contextSpecs.length > 0` still gates the `specs` slot (`run-executor.ts:303`) — untouched. Step 6 it-test. |
| Edge (19/08) | «Скіл перейменували або підняли його версію після прогону → у логу лишаються ім'я і версія на момент прогону.» | clear | The strings are captured into the message at run time; nothing re-reads the skill later. |
| Edge (19/08) | «Ім'я скіла містить розмітку, HTML або дуже довге → потрапляє в рядок логу як текст; `LiveLogStream` рендерить повідомлення текстовим вузлом …» | clear | Server-side: the name is interpolated as plain text, never escaped/parsed. No client change (verified in Design review, `client/src/vendor/ui/LiveLogStream.tsx:110-119`). |
| Edge (19/08) | «Не вдалося прочитати набір прикріплень скіла з БД → рядок логу називає скіл іменем і версією, прогін доходить до кінця.» | clear | AC-42; the `.catch()` degradation at `service.ts:311-316` stays, only its source attribution is added. Unit test (step 5). |
| NFR Observability | «один підсумковий рядок логу на прогін (AC-37), далі один рядок на кожен вкладений документ (шлях + джерело + оцінка токенів) і на кожен пропущений (шлях + джерело + причина); джерело … виводиться з тієї самої резолюції, що `specs_read`, тож лог і trace не можуть розійтися (AC-43). … Кількість рядків обмежена зверху кількістю прикріплень і бюджетом блоку (AC-20) …» | clear | The line count is unchanged except for exactly one added summary line per run; no new unbounded loop. |
| NFR Observability (пошук у логу) | «рядки лишаються придатними до фільтрування підрядком у `LiveLogStream` …: за `Project context` видно всю групу, за `skill` — усе успадковане.» | clear | Prefix `Project context: ` kept on every line incl. the summary; the inherited marker is the literal `via skill ` (contains `skill`). |
| NFR Contracts (атрибуція, AC-37…AC-44) | «жодної зміни на дроті: рядок логу лишається `RunLogLine { t, kind, msg }` …, `RunTrace.specs_read` лишається плоским списком шляхів, тож дзеркалити в `client/src/vendor/shared` нічого. Джерело живе тільки в тексті повідомлення і у ВНУТРІШНЬОМУ типі модуля: рекомендація для плану — нести його поруч із кожним записом `specsRead` / `skipped` у `ResolvedContextDocs` … як `{ kind: 'agent' } | { kind: 'skill', skillId, skillName, skillVersion }` (або паралельним масивом тієї самої довжини) … Ім'я і версію скіла резолвер отримує від виклику …, а не другим запитом до БД (AC-43).» | clear | Adopted literally in steps 1–3, choosing the *per-entry* form over the parallel array (see Decisions taken). No file under either `vendor/shared` is opened. |
| Delegation | Single-agent pass; change confined to `server/` (modules `context`, `reviews`, seed, tests); run the server unit lane (excludes `*.it.test.ts`), the integration lane (Docker), and dependency-cruiser; map every AC to a test or a manual check. | clear | Mode + Execution + Verification plan below. |

## Decisions taken

- **Execution mode: single-agent (one `implementer` run, one pass).** *human-answered* —
  delegation, verbatim: «the caller has decided — **single-agent pass** (one `implementer` run),
  the change is confined to `server/` (module `context`, module `reviews`, seed, tests)».
- **Log vocabulary: `attached` / `skipped` / `doc(s)`, not the screenshot's
  `injected` / `spec(s)` / `missing`.** *human-answered* — delegation: «take the stated defaults
  (code vocabulary `attached/skipped/doc(s)` …)», which is the spec's own default for the open
  question at `SPEC-01` § Open questions («default: словник коду»).
- **Seed fixture keeps both docs as `agent`; no skill-with-document is added to the demo.**
  *human-answered* — delegation: «seed keeps both docs as `agent`, no skill doc added»; the
  spec's default for that open question, whose reason is that `prompt_assembly.skills` of that
  fixture is `null` and a `via skill` line beside it would read as a contradiction.
- **No change to the trace drawer's Configuration card / Prompt assembly.** *human-answered* —
  delegation: «no change to the trace drawer's Configuration card»; spec default: the request is
  about Live Review, and `specs_read` on the wire stays a flat list of paths.
- **No wire/contract change, no client change.** *human-answered* — delegation, and NFR
  *Contracts (атрибуція)*: `RunLogLine` and `RunTrace.specs_read` are unchanged, so neither
  `server/src/vendor/shared` nor `client/src/vendor/shared` is edited.
- **Skill name + version are passed in from `run-executor`'s `linkedSkills`, not re-read from the
  DB.** *human-answered* — delegation, and AC-43. Consequence: the `ProjectContext.resolveForRun`
  signature's third parameter changes from `string[]` (ids) to a list carrying `{ id, name,
  version }`.
- **Source shape: per-entry, not a parallel array.** *default-assumed* — the spec offers both
  («або паралельним масивом тієї самої довжини»). Per-entry (a single internal
  `{ path, source }[]` from which `specsRead` is derived, and a `source` field on
  `SkippedContextDoc`) makes the AC-43 "same composition and order, always" invariant hold **by
  construction** rather than by a length assertion two arrays can drift out of — the exact
  failure mode `server/INSIGHTS.md` 2026-08-18 (Codebase Patterns) describes.
- **AC-42: the `(skill <id> context)` pseudo-path text is left as it is; the new
  `(via skill <name> v<version>)` source segment is what names the skill.** *default-assumed* —
  no interview was permitted; this is the additive reading. See Recommendations §1.
- **Token estimate in the `attached` line stays exactly as computed today** — chunk length /
  `BYTES_PER_TOKEN_EST` (`run-executor.ts:275`, `context/constants.ts:49`). *default-assumed* —
  AC-38 restates the existing suffix and no AC asks to change the number.

## Recommendations

Advice, not requirements. `plan-verifier` does not grade these.

1. **Drop the UUID from the skill lookup-failure pseudo-path** — `(skill <id> context)`
   (`server/src/modules/context/service.ts:311-316`) becomes `(skill context)` once the line
   itself names the skill, otherwise the AC-42 line reads
   `skipped (skill 9f3c… context) (via skill pr-quality-rubric v2) — …` with the skill named
   twice, once unreadably. Design review calls the UUID «нечитабельний». If accepted: step 2 also
   changes that literal and step 5's unit test asserts the shorter form.
   **Default: as requested** (keep the id).
2. **Assert the summary line's counters against `specs_read.length` in the same it-test**, not in
   a separate one — it turns AC-37 and AC-43 into one failing assertion when the resolution and
   the log disagree, which is the failure this group exists to prevent. If accepted: step 6 gains
   one `expect` line, no new file. **Default: as requested.**
3. **Add one `wait --text` step for the seeded summary line to
   `e2e/specs/10-project-context.flow.json`** — AC-44's own verify line reads
   «`*.it.test.ts` + e2e flow», and that flow already opens the trace drawer for exactly this
   fixture run. The caller confined the change to `server/`, so the plan does not do it. If
   accepted: one step in slice `e2e`, plus `./scripts/e2e.sh` in the Verification plan.
   **Default: as requested** (server-only; AC-44's e2e half stays uncovered — see Open questions).
4. **Type the hand-rolled container stubs in `server/test/skills-run-path.test.ts`** against
   `Pick<Container, 'projectContext'>` instead of `as unknown as Container`, so the next facade
   shape change fails `tsc` instead of surfacing as `undefined` at runtime. If accepted: a small
   edit inside step 4. **Default: as requested.**

## Constraints that bind this change

- **Does anything cross the wire?** **No.** `RunLogLine { t, kind, msg }`
  (`server/src/vendor/shared/contracts/trace.ts:13-18`) and `RunTrace.specs_read` are unchanged;
  the source lives in the message text and in a module-internal type. **Neither
  `server/src/vendor/shared` nor `client/src/vendor/shared` is edited**, and there is no mirror
  step. If an implementer finds itself opening either directory, the design has drifted.
- **Contracts are Zod-first.** Not affected — no route, no request body, no response schema is
  touched.
- **Migrations.** **None.** No schema change; no `server/src/db/migrations/**` file is created or
  edited. `server/src/db/seed.ts` is data, not schema.
- **Test lane.** New DB-backed tests go into existing `*.it.test.ts` files
  (`test/reviews.it.test.ts`, `test/context.it.test.ts`); new pure tests go into
  `test/context-helpers.test.ts` and `test/reviews-helpers.test.ts`, which the unit lane's
  `--exclude '**/*.it.test.ts'` keeps in the unit lane. No new file may be named `*.it.test.ts`
  unless it needs Postgres.
- **Package manager per step.** `server/` → **pnpm**, all commands run with cwd `server/` (or via
  `node scripts/verify.mjs` from the repo root, which sets cwd itself).
- **`reviewer-core` never emits JS.** Not affected — no `reviewer-core` file is touched; it is
  still cruised alongside `server/src` by the backend lane.
- **Do-not-touch paths.** None are needed: `server/clones/**`, applied
  `server/src/db/migrations/*.sql` and `**/src/vendor/ui/**` all stay closed. The fixture docs the
  seed writes live under `~/.devdigest/context-fixtures/<owner>/<repo>` (`seed.ts:129`), never
  under `config.cloneDir` (`server/INSIGHTS.md` 2026-08-18) — that is existing behaviour and must
  not be "simplified".
- **Layering.** Binds. `modules/reviews` may import **only** `modules/context/{constants,types}.ts`
  (`server/.dependency-cruiser.cjs:83-97`). Therefore: the `ContextDocSource` type goes in
  `modules/context/types.ts` (published surface); the attribution merge is a pure function in
  `modules/context/helpers.ts` (private, called only by `context/service.ts`); the log-line
  *formatting* is a pure function in `modules/reviews/helpers.ts` (the reviews module's own
  helpers, already unit-tested by `test/reviews-helpers.test.ts`). The facade stays
  `container.projectContext` — `run-executor.ts` must not start importing `context/service.ts`.

## Steps

| # | Change | Files / seams | Slice | Satisfies | Depends on | Executor | Skills the executor applies | Verification |
|---|--------|---------------|-------|-----------|------------|----------|-----------------------------|--------------|
| 1 | Publish the source type and the pure attribution merge: `ContextDocSource = { kind: 'agent' } \| { kind: 'skill'; skillId; skillName; skillVersion }` on the module's public surface; `SkippedContextDoc` gains `source`; `ResolvedContextDocs` carries a per-entry attached list (`{ path, source }[]`) from which `specsRead: string[]` is derived, so the two cannot disagree. Add a pure keep-first attribution helper over `[own…, per-skill…]` that returns each surviving path with its FIRST source. | `server/src/modules/context/types.ts:3-20`, `server/src/modules/context/helpers.ts` (new pure helper next to `dedupeKeepFirst:106-115`) | backend | AC-38, AC-39, AC-43 | — | `single pass` | `onion-architecture` (published surface = `types.ts`/`constants.ts` only), `fastify-best-practices`, `drizzle-orm-patterns` | `node scripts/verify.mjs --slice backend` |
| 2 | Thread the source through `resolveForRun`: third parameter becomes the enabled skills **with** `{ id, name, version }` (facade signature in `types.ts:66-70` + impl in `service.ts:295-351`); every `skipped` entry built at `:302-319` (lookup failures), `:323-329` (`skipAll`), `:341` (I/O) and inside `packDocs` (`helpers.ts:145-164`) is stamped with the resolved source; the skill lookup-failure entry at `:311-316` gets the skill's own source so AC-42's line can name it. No new DB or filesystem read. | `server/src/modules/context/types.ts`, `server/src/modules/context/service.ts:295-351`, `server/src/modules/context/helpers.ts` (`packDocs`, `skipAll`) | backend | AC-38, AC-39, AC-41, AC-42, AC-43 | 1 | `single pass` | `onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns` | `node scripts/verify.mjs --slice backend` |
| 3 | Live Review lines. Pass `linkedSkills.map(l => ({ id, name, version }))` — the same objects the `Skills:` line at `:229-235` is built from — into the facade call at `:264-268`. Emit, in this order: one summary line `Project context: <N> doc(s) attached, <M> skipped` (always, incl. `0`/`0`), then one `Project context: attached <path> (<source>, ~N tokens)` per attached doc, then one `Project context: skipped <path> (<source>) — <reason>` per skip, where `<source>` is `agent` or `via skill <name> v<version>`. Put the message-building in pure exported functions in `modules/reviews/helpers.ts`; `run-executor` only loops and calls `runLog.info`. Keep the `enabled` filter at `:225-227` untouched (AC-40) and the `contextSpecs.length > 0` prompt-slot gate at `:303` untouched (AC-25). | `server/src/modules/reviews/run-executor.ts:220-280`, `server/src/modules/reviews/helpers.ts` | backend | AC-37, AC-38, AC-39, AC-40, AC-41, AC-42, AC-43 | 2 | `single pass` | `onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns` | `node scripts/verify.mjs --slice backend` |
| 4 | Repair the hand-rolled facade stubs the shape change silently breaks: `test/skills-run-path.test.ts:98-100` returns the new `ResolvedContextDocs` shape (its `as unknown as Container` cast means `tsc` will NOT catch this — it fails at runtime as `undefined`). Grep for every other `resolveForRun` stub before assuming there is one. | `server/test/skills-run-path.test.ts:98-100` | backend | scaffolding for 3 (keeps the AC-40/AC-43 suites honest) | 3 | `single pass` | `onion-architecture` | `node scripts/verify.mjs --slice backend --only test/skills-run-path` |
| 5 | Unit tests (no container, no DB). In `test/context-helpers.test.ts`: attribution is keep-first across `agent → skill₁ → skill₂` (same path from agent + skill ⇒ `agent`; same path from two skills ⇒ first skill); a skill lookup failure carries that skill's name and version; a `packDocs` budget skip keeps its source. In `test/reviews-helpers.test.ts`: the three line shapes byte-for-byte, incl. the `0 doc(s) attached, 0 skipped` case, the exact prefixes `Project context: attached ` / `Project context: skipped `, the reason staying last in the skip line, and a case where the reason itself contains a dash. | `server/test/context-helpers.test.ts`, `server/test/reviews-helpers.test.ts` | backend | AC-37, AC-38, AC-39, AC-41, AC-42, AC-43 | 3 | `single pass` | `onion-architecture` (pure-function seam) | `node scripts/verify.mjs --slice backend` |
| 6 | Integration tests in `test/reviews.it.test.ts` (real container, `container.projectContext` NOT overridden — same style as the existing L05 cases at `:305-414`): (a) an agent-attached doc logs `(agent, ~N tokens)`; (b) a doc attached to an ENABLED linked skill logs `(via skill <name> v<version>, …)` with the same name/version as the run's `Skills:` line; (c) a doc attached to a DISABLED skill produces **no** line of any kind and is not counted in the summary; (d) a run with no attachments logs exactly one `Project context: 0 doc(s) attached, 0 skipped`; (e) an over-limit doc logs a `skipped` line carrying its source and its reason; (f) the attached-line paths, in order, equal `trace.specs_read`. Wait for the `run_traces` row, not just `waitForPrRuns`, before asserting on `trace.log` (`server/INSIGHTS.md` 2026-08-18). | `server/test/reviews.it.test.ts` | backend | AC-37, AC-38, AC-39, AC-40, AC-41, AC-43 | 3 | `single pass` | `onion-architecture`, `drizzle-orm-patterns` | `node scripts/verify.mjs --slice integration --only reviews` (Docker) |
| 7 | Demo fixture: rewrite the seeded trace log at `seed.ts:595-600` to the new format — the AC-37 summary line first, then the two `attached` lines with the `(agent, ~N tokens)` source segment (both stay `agent`; no skill document is added). Keep the token numbers and timestamps in the existing style and keep `.onConflictDoNothing()` (`:603`) so re-seeding stays idempotent. Assert it in `test/context.it.test.ts`, which already runs the real `seed()` (`:32`): the demo run's `run_traces.log` carries the summary line and both attributed `attached` lines, and a second `seed()` call does not duplicate or change them. | `server/src/db/seed.ts:595-600`, `server/test/context.it.test.ts` | backend | AC-44 | 3 | `single pass` | `onion-architecture`, `drizzle-orm-patterns`, `postgresql-table-design` (routed by `server/src/db/**`; nothing here designs a table) | `node scripts/verify.mjs --slice integration --only context` + the manual `pnpm db:seed` check below |

## Execution

**One pass.** Steps run in order 1 → 7; each step's verification runs immediately after that
step, not batched at the end. Steps 1–3 are one coherent edit of the resolution path — do not
stop between them with `tsc` red for long, but do run `node scripts/verify.mjs --slice backend`
before starting step 5, because step 4 exists precisely because a broken stub is invisible to the
typechecker.

Reviews are **not** part of this pass. After the last step the human runs, by hand:
`/code-review` (correctness), `architecture-reviewer` or `/pr-self-review` (boundaries — the
`no-cross-module-internals` edge in steps 1–3 is the thing worth a second pair of eyes), and
`/pr-self-review` again for the PR body incl. the Insights section (root `AGENTS.md`).

## Contract & migration impact

- **Wire: none.** `RunLogLine` and `RunTrace.specs_read` are unchanged, so no `@devdigest/shared`
  copy moves and there is no mirror step. This is the spec's own NFR, verified by reading:
  `client/src/vendor/ui/LiveLogStream.tsx:110-119` renders `msg` as a text node and never parses a
  prefix; `RunStatus.tsx` and `RunTraceDrawer/helpers.ts` map `{t, kind, msg}` one-to-one.
- **Internal contract: yes.** `ProjectContext.resolveForRun`'s third parameter and
  `ResolvedContextDocs`/`SkippedContextDoc` change shape. Both live in
  `server/src/modules/context/types.ts`, the module's published surface; the only production
  caller is `server/src/modules/reviews/run-executor.ts` and the only test caller is the stub in
  `server/test/skills-run-path.test.ts` (step 4).
- **Migrations: none.** No schema change, no new SQL file, no `pnpm db:migrate` needed for the
  automated lanes. `pnpm db:seed` is needed only for the manual AC-44 check.

## Verification plan

Run from the repo root, on **Node 22** (`nvm use 22` first — depcruise crashes under 18,
`server/INSIGHTS.md` 2026-08-11):

- `node scripts/verify.mjs --slice backend` — server typecheck + **dependency-cruiser**
  (`pnpm exec depcruise src ../reviewer-core/src --config .dependency-cruiser.cjs`) + the server
  **unit** lane (`pnpm exec vitest run --exclude '**/*.it.test.ts'`). Mirrors
  `.github/workflows/server-unit.yml`.
- `node scripts/verify.mjs --slice integration` — the server **integration** lane
  (`pnpm exec vitest run .it.test`). **Needs Docker**; testcontainers starts its own Postgres, so
  the running `devdigest-postgres` container is neither used nor required by this lane. Mirrors
  `.github/workflows/server-integration.yml`.
- Focused loops while iterating: `node scripts/verify.mjs --slice backend --only test/context-helpers`,
  `node scripts/verify.mjs --slice integration --only reviews`.
- **Manual (AC-44, the only check no lane performs):** with the `devdigest-postgres` container up,
  `cd server && pnpm db:seed`, then open PR #482's Agent runs tab → the seeded "General Reviewer"
  run's trace drawer, and read the log: one `Project context: 2 doc(s) attached, 0 skipped`
  summary followed by two `… (agent, ~N tokens)` lines. Re-run `pnpm db:seed` and confirm the log
  is unchanged (idempotency).
- **Manual (AC-37/AC-38 in the live panel):** start the stack (`./scripts/dev.sh`), attach a
  document to an agent and another to one of its enabled linked skills, run a review, and watch
  the Live Review panel — the summary line appears before the model call and the two `attached`
  lines name `agent` and `via skill <name> v<version>` respectively. This is what the request
  actually asked to see; no automated lane renders that panel.

No other lane is touched: `frontend`, `reviewer-core`, `mcp` and `e2e` have no file in this
change. `node scripts/pr-gate-ci.mjs` runs in CI regardless and needs nothing from this plan
(no vendored-UI, clone or applied-migration file is edited).

### AC → check map

| AC | Automated check | Manual check |
|---|---|---|
| AC-37 | step 5 unit (summary formatting incl. `0`/`0`) + step 6 it-test (d), and the summary present in every other case | Live Review panel (order: summary before the per-doc lines) |
| AC-38 | step 5 unit (both source forms) + step 6 it-tests (a), (b) — (b) also compares against the run's `Skills:` line | Live Review panel |
| AC-39 | step 5 unit (agent+skill, skill₁+skill₂ keep-first) + step 6: the duplicate path appears in exactly one line | — |
| AC-40 | step 6 it-test (c): no line, and the summary counters exclude it | — |
| AC-41 | step 5 unit (skip line shape, prefixes, reason last, reason containing a dash) + step 6 it-test (e) | — |
| AC-42 | step 5 unit: a skill `agentDocPaths`/`skillDocPaths` rejection yields a line naming `via skill <name> v<version>` and the run completes | — |
| AC-43 | step 5 unit (attached list ⇒ `specsRead` derived, same order) + step 6 it-test (f): log paths, in order, `toEqual(trace.specs_read)` | — |
| AC-44 | step 7 it-test in `context.it.test.ts` over the real `seed()` output, incl. re-seed idempotency | `pnpm db:seed` + the trace drawer of the seeded run |

## Out of scope / left to reviewers

- **AC-1…AC-36** — implemented and shipped; this plan neither re-plans nor re-verifies them.
- **Any client change** — `RunStatus.tsx`, `RunTraceDrawer/**`, `LiveLogStream.tsx`,
  `client/src/vendor/shared/**`. The spec's Design review states the client already renders the
  longer line correctly and parses nothing.
- **The trace drawer's Configuration card ("Specs read") and Prompt assembly section** — the spec's
  open question defaults to "log only" and the caller confirmed it.
- **`e2e/specs/10-project-context.flow.json`** — AC-44's e2e half; see Recommendations §3.
- The spec's **Non-goals**, verbatim and unchanged by this group: «Автоматичний добір документів
  за змістом PR»; «Редагування, створення й завантаження `.md` зі сторінки»; «Чанкінг, ембединги
  та індекс»; «Гейдж «78 COVERAGE»»; «Прикріплення, прив'язане до репозиторію»; «Вкладки
  `Evals` / `Stats` / `CI` та кнопки `Run Review ▾` / `▷ Run on evals`»; «Dry-run скіла …
  прикріплені документи туди не потрапляють у цьому лесоні»; «Зміна сенсу
  `PROJECT_CONTEXT_ROOTS`»; «Розширення типового списку імен за межі `INSIGHTS.md`»; «Зміна
  ліміту обходу 2000 файлів»; «Створення каталогу `insights/` у цьому репозиторії»; «Глоби й
  регулярні вирази в іменах».
- Architecture review, `/code-review`, `/security-review`, the e2e run and opening the PR — all
  left to the human after the pass (see Execution).

## Risks

- **The `resolveForRun` shape change is invisible to `tsc` in the test stubs.**
  `test/skills-run-path.test.ts:98-100` casts through `as unknown as Container`, so a stale stub
  compiles and then makes `run-executor` read `undefined` mid-run. *Earliest signal:* step 4 run
  before step 5 — that suite fails with "expected [] to have length 1"-shaped noise rather than a
  type error. Grep for `resolveForRun` across `server/test/` before assuming one stub.
- **A new it-test asserting on `trace.log` inherits the known trace-write race**
  (`server/INSIGHTS.md` 2026-08-18): `completeAgentRun` lands before `saveRunTrace`, so an
  assertion can read the route's row-shaped default. *Earliest signal:* an assertion reading
  `undefined`/`[]` on roughly one full-suite run in six, never in isolation. Wait for the
  `run_traces` row explicitly; do not retry the assertion.
- **Attribution drifting from `specsRead`** — the exact failure AC-43 exists to prevent, and the
  one a parallel array would invite. *Earliest signal:* step 6's it-test (f) comparing the log
  paths to `trace.specs_read`; keep that assertion in the same test as the summary counters
  (Recommendations §2) so a drift cannot pass by splitting across two green tests.
- **Boundary break under time pressure** — the shortest route to the skill name inside
  `context/service.ts` looks like "just query the skills repo there" (a second source of truth,
  forbidden by AC-43) or "import `context/helpers.ts` from `run-executor`" (forbidden by
  `no-cross-module-internals`). *Earliest signal:* `pnpm exec depcruise` in the backend lane, or
  a new `skillsRepo` call appearing in `context/service.ts` during review.
- **A skipped doc whose source is a lookup failure has no real path** — `(agent context)` /
  `(skill <id> context)` are pseudo-paths, and code that assumes `skipped[].path` is a real
  repo-relative path will format nonsense. *Earliest signal:* step 5's AC-42 unit test.

## Open questions

- **AC-44's e2e half** — the AC's verify line names «`*.it.test.ts` + e2e flow», and the caller
  confined the change to `server/`. **Default the executor assumes:** cover AC-44 with the
  it-test plus the manual `pnpm db:seed` check and leave
  `e2e/specs/10-project-context.flow.json` untouched (Recommendations §3 is the accept path).
- **The `(skill <id> context)` pseudo-path under AC-42** — keep the UUID or drop it now that the
  line names the skill. **Default the executor assumes:** keep it; add the source segment only
  (Recommendations §1).
