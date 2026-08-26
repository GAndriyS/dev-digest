import type { AgentCase } from "../../src/index.js";
import { fixtureReader, materializedWorktree } from "../../src/index.js";

const fx = fixtureReader(import.meta.url);

// MATERIALIZED FIXTURES — the history that led here, so nobody walks it backwards:
//
// v1 (through 2026-08-25): diffs PASTED into the prompt, never applied. Two failure modes,
// both measured. (1) The agent has tools and uses them: handed a diff whose target files the
// repo does not contain, it checked the working tree and correctly refused to review — the
// benign case went 0/2 on an agent doing exactly the right thing, and the checkout case passed
// only because its files happened to be lying around as untracked scratch. (2) Every rule-id
// practice was unreachable: depcruise runs against the live repo, which is green, so
// `core-has-no-io` appeared in no tool output and citing it was a memory test — 15% in BOTH
// arms of the A/B, discriminating nothing.
//
// v2 (2026-08-26, one day): a NOT_APPLIED preamble telling the agent the diff was proposed.
// That fixed refusals but conceded the gates: the reachability comment below had to say "do not
// re-add the gate practice against a pasted fixture".
//
// v3 (now): each case materializes into a REAL worktree — `fixtures/tree/` holds the pre-image,
// the diff is applied on top, and the session runs with cwd inside that tree
// (src/artifacts/worktree.ts). `git diff` shows exactly the fixture diff, tsc and depcruise can
// actually fire, and the rule id is IN the gate output when the agent runs it. The pasted diff
// stays in the prompt (production hands the reviewer a diff too); what changed is that the tree
// now agrees with it.
const preamble = (diff: string): string =>
  `Audit the uncommitted diff in this working tree against DevDigest's documented structural ` +
  `contracts. The change is already APPLIED to the tree — \`git diff\` shows it, and the ` +
  `machine gates can run against it.\n\n${diff}`;

const REVIEW_PROMPT = preamble(fx("checkout-service.diff"));

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
const REVIEWER_CORE_PROMPT = preamble(fx("reviewer-core-gate.diff"));

// A diff that violates NO documented rule (a pure local-variable rename inside a domain file, no
// new imports, no cross-layer edges). A grounded reviewer should report zero violations. This
// surfaces the COST of relaxing the citation rule: freed from "every finding must name a
// documented contract", the lite variant is more prone to fabricating a judgment/best-practice
// finding where the strict variant stays silent.
const BENIGN_PROMPT = preamble(fx("benign-refactor.diff"));

// Shared across the strict (architecture-reviewer) and relaxed (architecture-reviewer-lite)
// variants so the two agents are graded on the exact same task — the only thing that should
// move between the two runs is whether "cites the specific documented rule" keeps passing.
// (The lite eval runs only the A/B-relevant subset — see architecture-reviewer-lite.eval.ts.)
export const cases: AgentCase[] = [
  {
    name: "flags both violations in the checkout diff with severity and a citable rule",
    kind: "quality",
    prompt: REVIEW_PROMPT,
    setup: () => materializedWorktree(import.meta.url, "checkout-service.diff"),
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
    setup: () => materializedWorktree(import.meta.url, "checkout-service.diff"),
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
    name: "finds both reviewer-core violations in the diff",
    prompt: REVIEWER_CORE_PROMPT,
    setup: () => materializedWorktree(import.meta.url, "reviewer-core-gate.diff"),
    // The identifiers a report cannot be right without, graded by substring so the judge is never
    // paid to confirm a string match. `Verdict:` stays here for the same reason — see the note on
    // the verdict practice in the checkout case.
    grounding: ["readFileSync", "groundFindings", "Verdict:"],
    practices: [
      "flags the `import { readFileSync } from 'node:fs'` added to reviewer-core/src/pipeline/run.ts as a violation (reviewer-core must do no I/O except the injected LLMProvider)",
      "flags that runPipeline now returns `deduped` directly, dropping the mandatory `groundFindings()` gate before emitting findings",
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
    setup: () => materializedWorktree(import.meta.url, "reviewer-core-gate.diff"),
    // THE discriminating case of the A/B — the whole case is the one dimension the lite variant
    // drops, instead of that dimension being two of six practices whose failure was
    // indistinguishable from a missed violation.
    //
    // Both practices are REACHABLE now, each by a different road the materialized tree opens:
    // the fs-import id is in the depcruise output the agent can produce (`core-has-no-io` fires
    // in the worktree), and the grounding-gate contract is prose the agent's own instructions
    // send it to read (reviewer-core/AGENTS.md:20, the touched module's docs). The gate practice
    // was REMOVED on 2026-08-26 while the fixture was still a pasted diff — the tree was green,
    // the file was unopened, and the case went red on correct prose reasoning. Materialization
    // is the precondition the removal comment named for putting it back; here it is, back.
    practices: [
      "attributes the fs-import finding to a named documented contract with a locator — the `core-has-no-io` rule in `server/.dependency-cruiser.cjs`, or the no-I/O rule stated in `reviewer-core/AGENTS.md` — rather than describing it only in prose (\"the iron rule\", \"no I/O in the core\")",
      "attributes the dropped-`groundFindings()` finding to a named documented contract with a locator (the mandatory grounding rule in `reviewer-core/AGENTS.md`) rather than describing it only in prose",
    ],
    // 0.5 = one of two, deliberately NOT 1.0: the pre-split history for these two dimensions was
    // 15% and 38% — a 1.0 conjunction over them is the exact shape that sat at 0% for 20 CI runs.
    // One attribution is enough to separate the arms: the lite variant, with the citation rule
    // removed, is expected to land ZERO named contracts, so strict-vs-lite still reads clean at
    // this bar while the per-practice table tracks each road separately.
    threshold: 0.5,
    maxTurns: 25,
  },
  {
    name: "does not fabricate a documented-rule violation for a benign rename",
    kind: "quality",
    prompt: BENIGN_PROMPT,
    setup: () => materializedWorktree(import.meta.url, "benign-refactor.diff"),
    practices: [
      "reports no violations for the benign rename (or records only `info`-level, non-blocking observations) — it does not invent a critical/high/medium finding",
      "does not fabricate a documented-rule violation where the diff violates none of the checked rules",
      "the final gate verdict is PASS",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
];
