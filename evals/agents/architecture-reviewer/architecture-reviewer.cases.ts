import type { AgentCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

const fx = fixtureReader(import.meta.url);

// MEASURED IN CI AND LOCALLY, 2026-08-26 — the line below is load-bearing, do not trim it.
//
// This agent has tools and uses them: handed a pasted diff, it checks whether the file exists in
// the working tree. Two of the three fixtures target files this repo does not contain
// (`blast/score.ts`, `reviewer-core/src/pipeline/run.ts`), so it correctly refused to review —
// "Verdict: UNKNOWN — cannot scope the review ... diff target does not exist in the working tree"
// — and the benign case went 0/2 on an agent doing exactly the right thing. It had been passing
// at 88% only because earlier runs took the diff at face value without checking.
//
// Worse, the checkout fixture was passing for an ACCIDENTAL reason: `server/src/modules/checkout/`
// exists in this working tree as untracked scratch that every handoff brief tells agents to leave
// alone. Delete that directory and two more cases start failing the same way. Saying "not yet
// applied" once makes all three fixtures self-contained and removes the dependency on whatever
// happens to be lying around the tree.
const NOT_APPLIED =
  "The diff below is a PROPOSED change that has not been applied — the files may not exist in " +
  "the working tree yet, and the machine gates will not show it. Review the diff as written.";

const REVIEW_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${NOT_APPLIED}

${fx("checkout-service.diff")}`;

// A second real diff whose fs-import violation maps onto a DevDigest-SPECIFIC documented contract
// (`core-has-no-io`, server/.dependency-cruiser.cjs:123, and the same rule in prose at
// reviewer-core/AGENTS.md) that a competent model will describe as "the iron rule" but will not
// spontaneously ATTRIBUTE unless the agent forces a citation. This is the discriminating case for
// the strict-vs-lite A/B: both variants should FIND both problems, but only the strict variant
// (which keeps the "cite the documented rule per finding" hard rule) should reliably tie each
// finding to a named contract with a locator. The checkout diff's violations don't discriminate —
// the model volunteers a prose attribution either way.
//
// MEASURED, 2026-08-25 — do NOT reintroduce a rule name without grepping for it first. The
// original practices here demanded `reviewer-core-zero-io` and `reviewer-core-ground-findings-gate`.
// Neither string exists anywhere in this repo: across 16 baseline runs the agent said "iron rule"
// (9×) and `core-has-no-io` (1×), so both practices scored 0% in BOTH arms of the A/B and the
// designated discriminator had zero headroom to fall. An expectation that names an identifier the
// repo does not document measures the fixture author's memory, not the agent.
//
// The skipped-`groundFindings()` gate has NO rule identifier at all — the contract is prose in
// reviewer-core/AGENTS.md:20 ("Grounding is mandatory"). Its practice therefore grades the
// citation BEHAVIOUR (a named contract plus a locator) rather than a literal string.
const REVIEWER_CORE_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${NOT_APPLIED}

${fx("reviewer-core-gate.diff")}`;

// A diff that violates NO documented rule (a pure local-variable rename inside a domain file, no
// new imports, no cross-layer edges). A grounded reviewer should report zero violations. This
// surfaces the COST of relaxing the citation rule: freed from "every finding must name a
// documented contract", the lite variant is more prone to fabricating a judgment/best-practice
// finding where the strict variant stays silent.
const BENIGN_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${NOT_APPLIED}

${fx("benign-refactor.diff")}`;

// Shared across the strict (architecture-reviewer) and relaxed (architecture-reviewer-lite)
// variants so the two agents are graded on the exact same task — the only thing that should
// move between the two runs is whether "cites the specific documented rule" keeps passing.
export const cases: AgentCase[] = [
  {
    name: "flags both violations in the checkout diff with severity and a citable rule",
    kind: "quality",
    prompt: REVIEW_PROMPT,
    // Deterministic pre-gate, checked before the judge is paid. These are the MECHANICAL half of
    // the practices below — the identifiers the report must quote and the verdict line it must
    // end on — so they are graded by substring rather than by a stochastic judge. Every string
    // here was observed verbatim in real outputs across CI runs; a grounding gate must never be a
    // guess, because a miss fails the case hard and skips the judge entirely.
    grounding: ["FastifyReply", "PgCheckoutRepository", "Verdict:"],
    practices: [
      "flags the domain file (checkout.ts) importing a type from 'fastify' as a violation of the inward-only dependency rule between Domain and Presentation layers",
      "flags the `new PgCheckoutRepository()` call inside service.ts as a violation of DI discipline (concrete adapters/repositories must be constructed only in the composition root / container)",
      // Neither of this diff's violations is caught by a dependency-cruiser rule — `domain/checkout.ts`
      // is outside `service-stays-http-agnostic`'s path filter, and an inline `new` inside a module is
      // outside `no-direct-adapter-clients`. Both are judgement findings, so the citable contract is a
      // named section of the onion-architecture skill, not a rule id. Grading the BEHAVIOUR is what
      // makes this satisfiable; demanding a literal id here graded a string the repo never defines.
      "attributes EVERY finding to a named documented contract with a locator — a dependency-cruiser rule name, or a named rule/section of the onion-architecture skill or AGENTS.md — rather than describing the problem only in prose",
      "assigns a severity (critical/high/medium/low/info) to each finding",
      "quotes the offending line verbatim as evidence for each finding, not a paraphrase",
      // The agent's own scale is PASS | BLOCKED, never FAIL. The earlier "PASS/FAIL" wording scored 0%
      // on every diff that HAD violations (12 BLOCKED vs 4 PASS across the baseline runs) — it was
      // failing the agent for using its documented vocabulary.
      "ends with an explicit gate verdict on the PASS / BLOCKED scale",
    ],
    // 0.83 = five of six, NOT a softened bar: a threshold of 1.0 over six independently judged
    // practices is a conjunction, so a case whose practices each hold at p passes at p^6 — 73% at
    // p=0.95, i.e. red about one run in four with nothing wrong. Measured here: this case scored
    // 1.0 and then 0.83 on two runs with an IDENTICAL configuration (2026-08-25). Tolerating one
    // miss buys back the stability the conjunction spends; the non-negotiables moved up into
    // `grounding`, where they are checked deterministically and cannot be the tolerated miss.
    threshold: 0.83,
    maxTurns: 25,
  },
  {
    name: "does not fabricate an architecture finding for the out-of-scope security-shaped change",
    kind: "quality",
    prompt: REVIEW_PROMPT,
    practices: [
      "does not invent an architecture-contract violation for the optional `reply?: FastifyReply` parameter beyond the layering violation of the fastify import itself (no runtime bug/security finding fabricated as an architecture rule)",
      // Scoped to what lands in FINDINGS. The agent's return format makes an `### Out of scope` section
      // mandatory, and that section names tests and typecheck by design — the earlier "does not comment
      // on … test coverage" wording therefore scored 0% in both arms for obeying the artifact.
      "raises no FINDING about naming, style, formatting or test coverage — routing such an observation to the report's `Out of scope` / `Not flagged` section is correct and does not count as commenting on it",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  // ONE SESSION, TWO CASES. Split 2026-08-26 after 20 CI runs at 0% pass.
  //
  // The single case demanded six things of one report — find violation A, find violation B, cite
  // A, cite B, quote verbatim, land a verdict — at threshold 0.83, i.e. five of six. Per-practice
  // rates measured across those runs: 81% / 46% / 15% / 38% / 81% / 42%. No threshold rescues that
  // shape; the conjunction was the bug, not the bar. Splitting by QUESTION — "did it find them"
  // vs "did it attribute them" — gives each case a short conjunction, and it separates the two
  // things the A/B actually wants to tell apart: detection is the dimension both variants keep,
  // attribution is the dimension only the strict variant holds.
  {
    kind: "quality",
    name: "finds both reviewer-core violations in the pasted diff",
    prompt: REVIEWER_CORE_PROMPT,
    // The identifiers a report cannot be right without, graded by substring so the judge is never
    // paid to confirm a string match. `Verdict:` stays here for the same reason — see the note on
    // the verdict practice below.
    grounding: ["readFileSync", "groundFindings", "Verdict:"],
    practices: [
      "flags the `import { readFileSync } from 'node:fs'` added to reviewer-core/src/pipeline/run.ts as a violation (reviewer-core must do no I/O except the injected LLMProvider)",
      "flags that runPipeline now returns `deduped` directly, skipping the mandatory `groundFindings()` gate before emitting findings",
      "quotes the offending line verbatim as evidence for each finding, not a paraphrase",
    ],
    // Three practices, one tolerated miss. The middle one is the real signal: the skipped-gate
    // violation is the harder of the two to see (46% across the old runs) and it is what this
    // case exists to track.
    threshold: 0.67,
    maxTurns: 25,
  },
  {
    kind: "quality",
    name: "attributes each reviewer-core finding to a named documented contract",
    prompt: REVIEWER_CORE_PROMPT,
    // THE discriminating case of the A/B — the whole case is now the one dimension the lite
    // variant drops, instead of that dimension being two of six practices whose failure was
    // indistinguishable from a missed violation.
    //
    // MEASURED, 2026-08-25: an identifier-only wording (`core-has-no-io`, the real rule at
    // server/.dependency-cruiser.cjs:123) sat at 15% in BOTH arms and discriminated nothing. The
    // fixture is a PASTED diff that is never applied, and the agent runs depcruise against the
    // live repo — which is green — so the rule name appears in no tool output anywhere in the
    // session. To emit it the agent would have to open the config unprompted, which it does about
    // one run in six. An expectation only measures an artifact if the fixture makes the evidence
    // REACHABLE; that one made it a memory test with an 85% floor of noise.
    //
    // Naming the rule still counts — it is the strongest form of the answer and the wording keeps
    // it first — but so does any named contract with a locator, which is precisely what the lite
    // variant loses. Re-tightening this to a bare string is a regression unless the diff is first
    // materialised into a tree the gate can actually cruise.
    practices: [
      "attributes the fs-import finding to a named documented contract with a locator — the `core-has-no-io` rule in `server/.dependency-cruiser.cjs`, or the no-I/O rule stated in `reviewer-core/AGENTS.md` — rather than describing it only in prose (\"the iron rule\", \"no I/O in the core\")",
    ],
    // ONE practice, and the second one was REMOVED rather than tolerated — measured in CI,
    // 2026-08-26, on the first run of this split.
    //
    // The removed practice asked the report to attribute the skipped `groundFindings()` gate to a
    // named contract. There is no contract to name: unlike the fs import, the grounding gate has
    // no dependency-cruiser rule id anywhere, and its only statement is prose in
    // `reviewer-core/AGENTS.md:20` — a file the agent has no reason to open when the diff arrives
    // pasted into the prompt. So it failed with the agent reasoning correctly in prose ("appears
    // to be a transformation stage ... removing it breaks consumers expecting grounded data") and
    // the case, at threshold 1.0 over two practices, went red on work that was right. That is the
    // same "expectation must be REACHABLE" rule this file already states two comments above, and
    // I broke it while splitting the case — with the practice's own 38% history visible in the
    // data I was splitting from.
    //
    // What survives is the dimension the A/B actually needs: `core-has-no-io` IS a real id in a
    // file the agent does open, the strict variant cites it (observed verbatim, with
    // `server/.dependency-cruiser.cjs:123–135` as the locator), and the lite variant is the one
    // that stops. To get the gate half back, materialise the diff into a tree depcruise can
    // actually cruise — do not re-add the practice against a pasted fixture.
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "does not fabricate a documented-rule violation for a benign rename",
    kind: "quality",
    prompt: BENIGN_PROMPT,
    practices: [
      "reports no violations for the benign rename (or records only `info`-level, non-blocking observations) — it does not invent a critical/high/medium finding",
      "does not fabricate a documented-rule violation where the diff violates none of the checked rules",
      "the final gate verdict is PASS",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
];
