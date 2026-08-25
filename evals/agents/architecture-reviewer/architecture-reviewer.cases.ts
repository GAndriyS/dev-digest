import type { AgentCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

const fx = fixtureReader(import.meta.url);

const REVIEW_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

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

${fx("reviewer-core-gate.diff")}`;

// A diff that violates NO documented rule (a pure local-variable rename inside a domain file, no
// new imports, no cross-layer edges). A grounded reviewer should report zero violations. This
// surfaces the COST of relaxing the citation rule: freed from "every finding must name a
// documented contract", the lite variant is more prone to fabricating a judgment/best-practice
// finding where the strict variant stays silent.
const BENIGN_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("benign-refactor.diff")}`;

// Shared across the strict (architecture-reviewer) and relaxed (architecture-reviewer-lite)
// variants so the two agents are graded on the exact same task — the only thing that should
// move between the two runs is whether "cites the specific documented rule" keeps passing.
export const cases: AgentCase[] = [
  {
    name: "flags both violations in the checkout diff with severity and a citable rule",
    kind: "quality",
    prompt: REVIEW_PROMPT,
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
      "ends with an explicit gate verdict on the PASS / BLOCKED scale, derived from whether any critical findings exist",
    ],
    threshold: 1.0,
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
  {
    name: "cites the DevDigest-specific documented contract for reviewer-core violations",
    kind: "quality",
    prompt: REVIEWER_CORE_PROMPT,
    practices: [
      "flags the `import { readFileSync } from 'node:fs'` added to reviewer-core/src/pipeline/run.ts as a violation (reviewer-core must do no I/O except the injected LLMProvider)",
      "flags that runPipeline now returns `deduped` directly, skipping the mandatory `groundFindings()` gate before emitting findings",
      // THE discriminating practice of the A/B — and it grades the citation BEHAVIOUR, not one
      // literal identifier.
      //
      // MEASURED, 2026-08-25: the identifier-only wording (`core-has-no-io`, the real rule at
      // server/.dependency-cruiser.cjs:123) sat at 25% in BOTH arms and contributed nothing. The
      // fixture is a PASTED diff that is never applied, and the agent runs depcruise against the
      // live repo — which is green — so the rule name appears in no gate output anywhere in the
      // session. To emit it the agent would have to open the config unprompted, which it does
      // about one run in six. An expectation only measures an artifact if the fixture makes the
      // evidence reachable; this one made it a memory test with a 75% floor of noise.
      //
      // Naming the rule still counts — it is the strongest form of the answer, and the wording
      // keeps it first — but so does any named contract with a locator, which is precisely the
      // dimension the lite variant loses. Re-tightening this to a bare string is a regression:
      // materialise the diff into a tree the gate can actually cruise first.
      "attributes the fs-import finding to a named documented contract with a locator — the `core-has-no-io` rule in `server/.dependency-cruiser.cjs`, or the no-I/O rule stated in `reviewer-core/AGENTS.md` — rather than describing it only in prose (\"the iron rule\", \"no I/O in the core\")",
      // No identifier exists for the grounding gate, so this grades the citation behaviour instead.
      "attributes the skipped-gate finding to a named documented contract with a locator (the mandatory grounding gate in reviewer-core — `reviewer-core/AGENTS.md`, or the `groundFindings()` step of the pipeline) rather than describing it only in prose",
      "quotes the offending line verbatim as evidence for each finding, not a paraphrase",
      "ends with an explicit gate verdict on the PASS / BLOCKED scale, derived from whether any critical findings exist",
    ],
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
