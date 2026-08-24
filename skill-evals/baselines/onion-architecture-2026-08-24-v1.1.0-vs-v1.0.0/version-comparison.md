# onion-architecture v1.1.0 vs v1.0.0 — blind-spot cases (3, 4, 5)

One run per configuration per case, six reviews in total. `with-skill` is v1.1.0
(gained the "Blind spots — where the config is silent" section); `baseline` is
the v1.0.0 snapshot, which has no such section.

The three cases were built to test exactly what that section adds: each plants a
violation that dependency-cruiser cannot see, and each prompt tells the model the
config is green — an invitation to accept the green as evidence.

## Per-case results

| Case | Planted blind spot | v1.1.0 caught | v1.0.0 caught | Named the mechanism — v1.1.0 | Named the mechanism — v1.0.0 |
|---|---|---|---|---|---|
| 3 | `fetch()` in `reviewer-core` | yes | yes | yes | yes, at greater length |
| 4 | `import type { FastifyRequest }` in a service | yes | yes | yes | yes, with better line anchors |
| 5 | Inline query against `t.reviews` / `t.pullRequests` | yes | yes | yes | yes, plus one mechanism the other missed |

Controls:

| Case | Control assertion | v1.1.0 | v1.0.0 |
|---|---|---|---|
| 3 | No invented forbidden-import violation | pass | pass |
| 3 | Every finding cites file + line | pass | pass |
| 4 | Hand-rolled `safeParse(req.body)` | pass | pass |
| 4 | Route maps a domain error by message string | pass | pass |
| 4 | Every finding cites file + line | pass | pass |
| 5 | `remove()` unscoped by `workspaceId` | pass | pass |
| 5 | Data access inline in the service | pass | pass |
| 5 | Every finding cites file + line | pass | pass |

`*-fixtures-untouched` passes in all six runs (shasum -c, 12/12 OK).

**Pass counts:** case 3 — 5/5 and 5/5. Case 4 — 6/6 and 6/6. Case 5 — 6/6 and
6/6. Twelve of twelve on the discriminating assertions across both
configurations. A clean tie.

## The key question: did the new section change anything?

No. On this evidence v1.0.0 produced every conclusion v1.1.0 produced, on all
three blind spots, and it got there without being told they existed.

### Blind spot 1 — network I/O in the core (case 3)

v1.0.0 found it. Its path was **the dependency-cruiser config**, read directly
and reasoned about, plus the v1.0.0 iron-rule prose. It quotes the two
`core-has-no-io` path patterns out of `server/.dependency-cruiser.cjs` and then
states the mechanism:

> «`fetch` — це **глобал Node 22**, у нього немає рядка імпорту. Депкруз будує
> граф залежностей із імпортів; ребра тут просто не існує, тому перевіряти
> нічого. Зелений депкруз означає «немає забороненого імпорту», а не «немає
> I/O».»

It then adds a counterfactual v1.1.0 does not: had the same request been written
as `import { request } from 'node:https'`, CI would have failed instantly. The
remediation — advisories arrive already resolved — it derives from the v1.0.0
line "Need I/O? It belongs in the caller. New inputs arrive as resolved strings —
skill *bodies*, not slugs", which it cites and generalises.

v1.1.0's version of the same paragraph is shorter and cites the skill as its
authority ("це саме та сліпа зона, про яку прямо сказано в скілі
`onion-architecture` (розділ «Blind spots», пункт 1)"), then reproduces the same
mechanism from the config.

### Blind spot 2 — `import type { FastifyRequest }` in a service (case 4)

v1.0.0 found it, and pre-empted the wrong intuition by name:

> «**Окремо наголошую: `import type` тут НЕ рятує.** Це найпоширеніша хибна
> інтуїція в цьому місці, бо в сусідньому правилі `import type` справді
> дозволений. Різниця механічна й перевіряється в конфізі»

Its path is **v1.0.0's own prose read narrowly, then verified against the
config**. It quotes the v1.0.0 line — "`import type` of a port interface is
always fine" — notices that the sentence is scoped to *port interfaces*, and goes
to `server/.dependency-cruiser.cjs` to check whether the neighbouring rule shares
the exception. It finds `dependencyTypesNot: ['type-only']` on
`no-direct-adapter-clients` and its absence on `service-stays-http-agnostic`, and
confirms `tsPreCompilationDeps: true` puts the type edge in the graph. That is
precisely the reasoning v1.1.0 point 2 was written to supply.

Both configurations then give the same substantive reason: `FastifyRequest` is
not a domain abstraction, so naming it from inside a service means the signature
speaks HTTP.

Worth noting: this one is not a true blind spot. Because
`service-stays-http-agnostic` lacks the type-only escape and the config compiles
types into the graph, depcruise **does** fail here. Both reviews say so and both
are right. The case tests resistance to a plausible excuse, not blindness.

### Blind spot 3 — another module's tables (case 5)

v1.0.0 found it, and led the review with it rather than burying it — the
document opens with a section titled «Спершу про «депкруз зелений»»:

> «Правило `no-cross-module-internals` (`server/.dependency-cruiser.cjs:83-97`)
> матчить шляхи виду `^src/modules/<x>/`. Читання **чужих таблиць** через
> спільний барель `src/db/schema.ts` для нього невидиме — це обхід межі
> стороною, яку конфіг не бачить.»

Its path is **the config, read rule by rule**. It also produces a second blindness
mechanism neither the skill nor v1.1.0 mentions: there is deliberately no
`routes-through-service` equivalent for `service.ts`, because a repository must
import the schema and the config cannot tell a repository from a service in the
same folder — so a direct Drizzle query from a service passes silently. Both
configurations reach `container.reviewRepo` as the fix and both cite
`server/src/platform/container.ts:111-113` correctly.

## Depth difference

There is one, and it does not run the way the version bump predicts.

- **Case 3, mechanism depth: v1.0.0 deeper.** It quotes the rule's path patterns
  verbatim and supplies the `node:https` counterfactual. v1.1.0 states the
  mechanism correctly but leans on the skill as the citation.
- **Case 4, citation accuracy: v1.0.0 better.** v1.0.0 anchors
  `service-stays-http-agnostic` at `:63-70` (real: 62-70) and
  `no-direct-adapter-clients` at `:72` (real: 71). v1.1.0 cites `:78-86` and
  `:88-97` for the same two rules and `:186` for `tsPreCompilationDeps` in a
  180-line file — every rule name is right, every coordinate is off by roughly
  sixteen lines. Its SKILL.md anchors, by contrast, are exact (`SKILL.md:151-179`
  really is the Blind spots section), which suggests the offsets come from
  reading the config less carefully once the skill had already given the answer.
- **Case 5, coverage of mechanisms: v1.0.0 wider** (two blindness paths named
  versus one).
- **Where v1.1.0 is ahead:** breadth of findings and cross-case transfer. It
  reported more findings in every case (12/11/10 vs 10/10/8), and in case 4 it
  spontaneously applied blind spot 3 to an unrelated part of the module —
  observing that the unseen `listMerged` will read the `pulls` tables and that an
  inline `container.db` query there would be invisible to depcruise. That is the
  section doing something the case did not ask for. It also found the
  `.nullish()` empty-POST trap recorded in `server/INSIGHTS.md`, and in case 5
  found two consequential items v1.0.0 missed (the wire-DTO fed straight into
  `values(rule)`, and nullable `verdict`/`score` leaking into `AlertHit`).
  None of these are graded, and none of them are blind spots.

## Signal to noise

| Run | Findings reported | Planted violations in case | False findings | Tokens |
|---|---|---|---|---|
| case 3 · v1.1.0 | 12 | 1 | 0 | 66,261 |
| case 3 · v1.0.0 | 10 | 1 | 0 | 73,495 |
| case 4 · v1.1.0 | 11 | 3 | 0 | 74,268 |
| case 4 · v1.0.0 | 10 | 3 | 0 | 67,527 |
| case 5 · v1.1.0 | 10 | 3 | 0 | 66,843 |
| case 5 · v1.0.0 | 8 | 3 | 0 | 65,673 |

Zero false findings in six reviews. Every load-bearing claim was checked against
source: the depcruise rule names and their `dependencyTypesNot` settings,
`container.reviewRepo` at `container.ts:111-113`, the `reviews` column list (no
`findings` column — it is a separate table), the `digests` columns in
`db/schema/ops.ts`, `StructuredResult.data`, the uppercase `Severity` enum,
`OkResponse`, the 422 handler in `app.ts`, and the absence of
`AlertRule`/`AlertHit`/`DigestBuild`/`EnrichedFinding` and the `alert_*` tables.
All correct in both configurations.

The gap between findings reported and violations planted is large in every run,
but it is legitimate: the fixtures import tables, contracts and helper files that
do not exist in this repo, so both configurations correctly report a long tail of
"this will not compile" items. Those are excluded from grading. Neither
configuration padded, and neither invented a violation to look thorough — in
particular, both correctly declined to call `enrich.ts`'s imports forbidden.

The token cost is a wash: v1.1.0 is cheaper in case 3, dearer in case 4, level in
case 5.

## Verdict

**v1.1.0 does not earn its version bump on this evidence.** Twelve of twelve
discriminating assertions pass in both configurations. On all three blind spots
the old skill reached the same conclusion, named the same mechanism, proposed the
same fix, and in two of three cases explained the mechanism in more depth and
with more accurate config citations than the new one. The new section made the
answer cheaper to reach, not reachable. That is a real but modest gain, and it is
partly offset by a visible cost: the with-skill runs cite the config more
loosely, consistent with taking the skill's word instead of re-deriving from the
source.

The reason is legible in the diff. v1.0.0 already contained all three
principles as prose — "Need I/O? It belongs in the caller", "`import type` of a
port interface is always fine" (scoped, correctly, to ports), "`repository.ts` —
the only place that touches its tables". What v1.1.0 adds is the *framing* that
depcruise cannot see them. But every case prompt hands the model that framing for
free by asserting "депкруз зелений", and the config is a 180-line file the model
reads anyway. Under those conditions the section is redundant with the
environment.

What would have to change, in order of value:

1. **Make the cases stop pre-announcing the blind spot.** Drop "депкруз і
   тайпчек зелені" from the prompts. As written, the prompt is the strongest
   single hint in the run and it is given to both configurations. A neutral
   prompt ("review this before I open a PR") is the only way to learn whether
   the skill or the prompt produced the insight.
2. **Retire or repurpose case 4.** Its planted violation is caught by
   dependency-cruiser, so it does not test config blindness at all. Either
   re-file it as a control for "does not rationalise a type-only import", or
   replace it with a real type-only blind spot.
3. **Raise the bar to one v1.0.0 cannot clear from the config.** All three
   current blind spots are recoverable by reading
   `server/.dependency-cruiser.cjs` and asking "what would this rule match?" — a
   step both configurations took unprompted. A discriminating case needs a
   violation whose mechanism is *not* legible from the config: e.g. a service
   that takes `Container` but reads `container.config.secretsPath` and shells out
   through an already-imported helper, or a port whose interface is imported
   correctly while the concrete class is reached through a re-export.
4. **Run more than one trial.** Six single runs cannot distinguish a real effect
   from variance. Three runs per cell would at least bound it.
5. **If the section stays, tighten it rather than grow it.** Its measurable
   effect here was to substitute a skill citation for a config citation. Adding
   "and verify against `server/.dependency-cruiser.cjs` before citing line
   numbers" would recover the accuracy the with-skill runs lost.

Recommended: keep the section — it is correct, it costs little, and case 4 shows
it transferring to a module it was not aimed at — but re-issue it as 1.0.1 rather
than 1.1.0, and rebuild the cases before claiming the behaviour changed.
