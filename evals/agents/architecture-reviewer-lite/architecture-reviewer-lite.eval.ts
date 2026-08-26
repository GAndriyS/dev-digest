import { describeAgent, runAgentCases } from "../../src/index.js";
// Deliberately reuses the strict variant's cases — same fixture, same practices, same
// threshold. Only the injected agent artifact differs (architecture-reviewer-lite has the
// "cite the specific documented rule per finding" hard rule removed). That is what makes this
// pair a controlled A/B rather than two unrelated evals: pnpm eval:repeat both with labels and
// pnpm eval:delta them to see exactly which practice moved.
import { cases } from "../architecture-reviewer/architecture-reviewer.cases.js";

// The lite arm runs only the cases that answer the A/B's question — "what is the citation
// requirement worth?" Three of the five qualify, each by the cases file's own design notes:
// the attribution case is THE discriminator (the dimension lite drops), the detection case is
// the parity check ("both variants should FIND both problems" — without it, 'finds but does not
// attribute' is indistinguishable from 'missed it'), and the benign case is the cost check (the
// documented fabrication risk of relaxing the rule). The checkout and out-of-scope cases don't
// discriminate — "the model volunteers a prose attribution either way" — so running them on
// lite spent two sessions per iteration measuring nothing the strict arm doesn't already.
const AB_CASES = new Set([
  "finds both reviewer-core violations in the diff",
  "attributes each reviewer-core finding to a named documented contract",
  "does not fabricate a documented-rule violation for a benign rename",
]);
const abCases = cases.filter((c) => AB_CASES.has(c.name));
if (abCases.length !== AB_CASES.size) {
  // A renamed case must fail loudly here, not silently shrink the A/B to fewer cases.
  throw new Error(
    `architecture-reviewer-lite: expected ${AB_CASES.size} A/B cases, matched ${abCases.length} — a case was renamed?`,
  );
}

describeAgent("architecture-reviewer-lite", () => runAgentCases("architecture-reviewer-lite", abCases));
