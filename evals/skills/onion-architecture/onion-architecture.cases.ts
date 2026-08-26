import type { SkillCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

const fx = fixtureReader(import.meta.url);

/**
 * `onion-architecture` is the skill the repo's own machine gate is built around: six of the rules
 * it teaches exist as dependency-cruiser rule ids in `server/.dependency-cruiser.cjs`, and CI runs
 * them. That is exactly why the skill needs an eval — the gate proves the rules are *enforced*, it
 * cannot prove the skill *teaches* them, and the two halves drift apart silently.
 *
 * The fixtures are ported from the pre-existing `skill-evals/` harness
 * (`.claude/skills/onion-architecture/evals/`), where each one is a plausible slice of DevDigest
 * code with a known set of planted violations and no comment hinting at them — the docblocks
 * explain the feature, not the problem. Two changes were needed to bring them into this package:
 *
 *  1. **The file content is inlined into the prompt.** `skillTask` injects SKILL.md as the system
 *     prompt and grants NO tools (see tasks.ts), so "read these three files" is unanswerable here.
 *     Inlining keeps the *content* under test and drops the tool-use dimension, which is what this
 *     tier is for; the tool-use dimension belongs to the workflow tier.
 *  2. **Only rule names the repo actually documents are graded as strings.** The legacy fixtures
 *     annotate some violations with prose ("another module's tables are not yours", "НЕ ловиться
 *     депкрузом") — those are contracts, not identifiers. Grading them as literals would repeat
 *     the mistake measured on the architecture-reviewer cases (2026-08-25): an expectation naming
 *     a string the repo does not document scores 0% forever and measures the fixture author's
 *     memory. Verified before writing: `routes-through-service`, `no-direct-adapter-clients`,
 *     `service-stays-http-agnostic`, `core-has-no-io` and `core-does-not-import-server` all appear
 *     in `server/.dependency-cruiser.cjs` AND in the skill's own SKILL.md.
 *
 * Judge stability is bought structurally, not with a soft threshold: every claim that is a string
 * match lives in `grounding` (deterministic, judge skipped if it misses), and each practice
 * carries exactly ONE claim. The measured failure mode across this package is the practice that
 * bundles two independent claims — it is as fragile as two and reports as one.
 */

const EXPORTS_MODULE = `routes.ts
${fx("exports-routes.ts")}

service.ts
${fx("exports-service.ts")}

repository.ts
${fx("exports-repository.ts")}`;

const CORE_SUMMARIZER = fx("core-summarizer.ts");

// Neutral on purpose: no "architecture", no "layers", no count of problems. A prompt that names
// the dimension hands it to the artifact-off baseline too and flattens the measured lift to zero
// (README, "Low lift is usually a task-design signal"). The fixtures reference tables and helpers
// that do not exist in this repo, so both configurations additionally report "this does not
// compile" — expected noise, graded by nothing.
const NEW_MODULE_PROMPT = `Here is a new \`exports\` module I am about to merge into
server/src/modules/exports. Look it over before I open the PR and tell me what needs fixing.

${EXPORTS_MODULE}`;

const CORE_PROMPT = `Here is a new summarizer I am adding to reviewer-core. Look it over before I
open the PR and tell me what needs fixing.

${CORE_SUMMARIZER}`;

export const cases: SkillCase[] = [
  {
    name: "new module: names all three layering violations in routes and service",
    kind: "quality",
    prompt: NEW_MODULE_PROMPT,
    // The three symbols a correct review cannot avoid quoting — the Drizzle call the handler makes
    // directly, the adapter it constructs itself, and the Fastify type that reached the service.
    // Substring-graded so the judge is never paid to confirm a string match.
    grounding: ["OctokitGitHubClient", "FastifyRequest"],
    practices: [
      "flags that the GET /pulls/:id/exports handler in routes.ts runs a database select itself instead of delegating to ExportsService",
      "flags that service.ts constructs OctokitGitHubClient directly instead of resolving the GitHub adapter from the DI container",
      "flags that ExportsService.create() takes a FastifyRequest and reads headers or body inside the service, instead of receiving already-resolved values",
      // The dimension that separates this skill from generic "clean architecture" advice: these
      // three are dependency-cruiser rule ids that CI enforces, and the skill documents all three.
      // Graded as behaviour (a named rule for at least one finding) rather than three literals, so
      // one unlucky wording does not zero the practice.
      "names at least one of the repo's documented dependency-cruiser rules — routes-through-service, no-direct-adapter-clients or service-stays-http-agnostic — as the contract a finding breaks, rather than describing every problem only in prose",
    ],
    // Four practices, one tolerated miss. The three detection practices are the signal; the
    // attribution practice is the one most likely to be the miss, which is the correct thing to
    // tolerate — a review that finds all three problems and cites none is still useful, a review
    // that cites a rule while missing the violations is not.
    threshold: 0.75,
    maxTurns: 10,
  },

  {
    name: "core purity: both I/O violations and the inward import are caught",
    kind: "quality",
    prompt: CORE_PROMPT,
    // `node:fs` and `fetch` are the two side effects; `loadConfig` is the inward import. All three
    // appear verbatim in the fixture, so a review that engages with it at all quotes them.
    grounding: ["node:fs", "loadConfig"],
    practices: [
      "flags that the summarizer reads skill bodies from disk with node:fs inside reviewer-core, when the core's only permitted side effect is the injected LLMProvider",
      "flags the direct fetch() call to the GitHub REST API as a second violation of the same no-I/O rule, not only the filesystem read",
      "flags that the file imports loadConfig from server/src/platform/config.js, which points reviewer-core inward at the server package",
      "names `core-has-no-io` or `core-does-not-import-server` — the repo's documented dependency-cruiser rules for these two problems — rather than describing them only as 'the core must stay pure'",
    ],
    // Same shape and the same reasoning as above. Measured expectation going in: the fetch() call
    // is the likeliest miss — it sits 30 lines below the node:fs import and reads as feature code.
    threshold: 0.75,
    maxTurns: 10,
  },

  {
    name: "recommends the documented fix shape rather than only naming the problem",
    kind: "quality",
    prompt: NEW_MODULE_PROMPT,
    practices: [
      "for the direct adapter construction, the recommended fix is to resolve the client from the DI container (for example `await container.github()`), not merely 'inject it' in the abstract",
      "for the handler that queries the database itself, the recommended fix is to move that query into the service or repository layer, naming which one",
    ],
    // Two practices, both required. A short conjunction can carry 1.0 without the p^N problem: at
    // p=0.9 per practice this case is red about one run in five with nothing wrong, against one in
    // four for a six-practice case at the same p — which is why the long cases above tolerate a
    // miss and this one does not.
    threshold: 1.0,
    maxTurns: 10,
  },
];
