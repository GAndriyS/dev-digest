import type { SkillCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

const fx = fixtureReader(import.meta.url);

/**
 * `dependency-checker` is a TOOL-USING skill in production — it shells out to
 * `scripts/deps-report.mjs` and reads six package.json files. Quality cases run with NO tools
 * (skillTask injects SKILL.md as the system prompt and measures its content in isolation, see
 * tasks.ts), so every prompt here hands the model the fact base up front. That is not a
 * workaround: the skill defines a **Supplied mode** for exactly this situation, and one of the
 * cases below measures whether the skill honours it instead of stalling for tool access.
 *
 * The fixture is a synthetic six-package repo, deliberately NOT this one — same layout rules
 * (six manifests, six lockfiles, two package managers, path-alias edges) but different libraries,
 * so a passing score reflects the skill's method rather than a memorised report of DevDigest.
 *
 * It carries FACTS ONLY — no conclusions, no annotations, nothing labelled as a problem. That is
 * a benchmark requirement, not a style choice: `eval:benchmark` runs these same prompts with the
 * skill switched off, and any give-away the fixture states outright is one the raw model reads
 * back for free, flattening the measured lift to zero (README, "Low lift is usually a task-design
 * signal"). So the traps below are *derivable* from the data and stated nowhere in it:
 *
 *   figlet          in server deps · zero imports · absent from scripts and every excerpt
 *                     → the one genuinely dead dependency.
 *                     MEASURED, 2026-08-26: this slot used to be `chalk`, and it scored 1/6 in
 *                     CI because the answer was RIGHT and the fixture was wrong — `chalk` is a
 *                     transitive dependency of `pino-pretty`, which this same fixture declares,
 *                     so the model correctly wrote "loaded indirectly by pino-pretty, keep it"
 *                     and then correctly refused to call anything removable. A dead-dependency
 *                     slot must name a package that NOTHING else in the fixture can plausibly
 *                     pull in; otherwise the trap catches the fixture author, not the skill.
 *   pino-pretty     zero imports, but the logger.ts excerpt has it as `transport.target`
 *                     → NOT dead; the import scan structurally cannot see it
 *   vitest/tsc/tsx  zero imports, but each appears in a "scripts" entry     → NOT dead
 *   esbuild         in `dependencies`, and the only thing that uses it is the build script
 *                     → misplaced, belongs in devDependencies
 *   zod             ^3.24.1 in three packages vs ^4.1.0 in mcp — and shared/index.ts exports a
 *                     Zod schema that mcp/src/tools/findings.ts calls .parse() on
 *                     → the split crosses the wire: P0
 *   relative import mcp/src/tools/review.ts reaches server/src/modules/.../repository.js while
 *                     every other cross-package line goes through an alias  → boundary P0
 *   puppeteer       340.2 MB exclusive against 1 import site                → weight, P2
 *   not a workspace six lockfiles, per-package node_modules, no root manifest in the root listing
 *   reviewer-core   its size is simply ABSENT from the size list (`—` in the totals)
 *                     → must be reported as unknown, never estimated
 */
const REPO_DATA = fx("supplied-repo-data.md");

const ask = (task: string) => `${task}\n\n${REPO_DATA}`;

export const cases: SkillCase[] = [
  {
    name: "full report follows the required section skeleton with a Mermaid graph",
    kind: "quality",
    // The task names no section on purpose. An earlier version asked for "graph, sizes, findings,
    // recommendations" and thereby dictated four of the six sections in the prompt itself — which
    // hands them to the artifact-off baseline too and costs the case most of its discriminating
    // power. What the report must contain is the skill's job to know.
    prompt: ask("Do a dependency audit of this repo."),
    // MEASURED, 2026-08-26: this gate used to demand the literal `flowchart`, and it failed a
    // report that had produced a correct, complete Mermaid graph written `graph LR` — `graph` and
    // `flowchart` are two spellings of the SAME Mermaid diagram type, both current, and the
    // rendered output is identical. The gate was grading a synonym choice and hard-failing the
    // case, which skips the judge entirely. `-->` replaces it: an edge arrow proves the block is
    // a real graph rather than an empty fence, and it is keyword-agnostic.
    grounding: ["```mermaid", "-->"],
    practices: [
      "the report opens with a Scope section naming which packages were analysed and stating where the numbers came from (supplied in the request rather than measured by running a command)",
      "the report contains a fenced ```mermaid code block that graphs the packages as nodes and edges, rather than describing the graph only in prose",
      "the report has a size/weight section built as a TABLE with one row per dependency, not a prose paragraph about sizes",
      "the report keeps a section for the INTERNAL path-alias dependencies that is separate from the tables of installed npm packages",
      "the report has a findings section that groups findings under explicit severity tiers such as P0, P1, P2 and Info, rather than one unranked list",
      "the report ends with a Summary of three to five numbered takeaways, each naming a concrete package and a concrete action",
    ],
    threshold: 0.7,
    maxTurns: 10,
  },

  {
    name: "separates internal path-alias edges from npm packages and never calls them a workspace",
    kind: "quality",
    prompt: ask(
      "These packages share code with each other, and they also install things from npm. " +
        "Map out how everything depends on everything else.",
    ),
    practices: [
      // Split from one two-clause practice into two single-claim ones. As a conjunction it
      // scored 0/6: the answer reliably DID separate the alias edges from the npm packages and
      // then did not use the words "not installed from a registry", so the whole practice went
      // red and the half that held was invisible. A practice that bundles two independent claims
      // is as fragile as two practices and reports as one.
      "the answer separates the internal cross-package edges (the @devdigest/shared and @devdigest/reviewer-core TypeScript path aliases) from the external npm dependencies, rather than listing them together",
      "the answer states that those internal edges resolve through TypeScript path aliases to files in the repo, not through an npm registry install",
      "the answer flags the relative import in mcp/src/tools/review.ts reaching into server/src/modules/reviews/repository.js as a boundary violation that bypasses the package's public entry point, and ranks it at P0",
      "the answer states that these are independent packages with their own lockfiles and does NOT describe them as a pnpm/npm workspace or as being linked by the workspace: protocol",
      "the answer notes that each package installs its own copy of a shared library, for example that typescript is installed six times, and treats that as a fact about the layout rather than a defect to fix",
    ],
    threshold: 0.75,
    maxTurns: 10,
  },

  {
    name: "ranks by the tier rules and recommends rather than executes",
    kind: "quality",
    prompt: ask("Check our dependencies and tell me what to fix first."),
    practices: [
      // THE TIER IS THE CONTRACT; THE WORDING OF THE REASON IS NOT.
      //
      // MEASURED over two validation runs, 2026-08-26: every practice that graded a *reason*
      // landed at 50% — esbuild's (1/2), puppeteer's justification (1/2), and zod's when it was
      // bundled with the ranking (1/2) — while every practice that graded a *tier* passed. The
      // model ranks correctly and then justifies in its own words; grading the justification
      // measures rhetoric and spends the case's whole miss budget doing it. So each of the three
      // tiers is now its own single-claim practice, and exactly ONE reason survives: zod's, which
      // is not rhetoric — "a wire-crossing contract built by two different majors" IS the P0 row
      // of the skill's own tier table, so a P0 given for any other reason is luck. Its wording
      // accepts any correct articulation of the boundary crossing rather than one phrasing.
      // MERGED BACK, 2026-08-26 — and the reason refines the split-your-practices rule rather
      // than contradicting it: SPLIT practices that are INDEPENDENT, MERGE ones that are perfectly
      // correlated. These two were the same judgement. Measured: when the report sees that the
      // shared contract is parsed on the far side of a package boundary it ranks P0 and explains
      // it; when it decides "mcp's version is isolated" it ranks P1 and explains that instead.
      // Never once did one half hold without the other — so splitting them doubled the penalty
      // for a single miss and added no information about which half failed.
      "the two majors of zod (^3.24.1 in server, client and reviewer-core against ^4.1.0 in mcp) are ranked P0, because the two majors meet across a package boundary — mcp parses server responses built with the shared Zod contracts — rather than being treated as version untidiness inside one package",
      "esbuild being declared in server's `dependencies` rather than `devDependencies` is ranked P1",
      "puppeteer is ranked P2 rather than P0 or P1",
      "every finding names a specific package and dependency, and where one exists a file or package.json, instead of generic advice such as 'consider reviewing your dependencies'",
      "removals and version bumps are presented as proposals for the user to confirm, and the answer does not claim to have edited a package.json, run an install, or applied any fix",
    ],
    threshold: 0.8,
    maxTurns: 10,
  },

  {
    name: "a dependency with no import site is a candidate, not a verdict",
    kind: "quality",
    prompt: ask(
      "The import scan says several of our dependencies are never imported. Which of them can I actually delete?",
    ),
    practices: [
      "figlet is identified as the strongest removal candidate, because it has no import, no config reference and no package script",
      "pino-pretty is NOT called unused: the answer points out it is named as a string in the Pino transport target at server/src/logger.ts:22, which an import scan cannot see",
      "vitest, typescript and tsx are NOT called unused: the answer points out they are invoked from package scripts rather than imported from source",
      "the answer frames the import-scan result as a candidate needing confirmation — wording such as 'no import found, confirm before removing' — rather than declaring a dependency unused outright",
    ],
    threshold: 0.75,
    maxTurns: 10,
  },

  {
    name: "supplied mode: reports on the data given and marks the unmeasurable as unknown",
    kind: "quality",
    prompt: ask(
      "I can't give you shell access on this machine — work from what I've pasted below and give me the report anyway.",
    ),
    practices: [
      "the answer produces the full report from the supplied data instead of refusing, stalling, or asking for tool access or for permission to run a command",
      "the install size of reviewer-core is reported as unknown (or an equivalent explicit 'could not be measured'), and no number is invented for it",
      "the answer says what would establish the missing reviewer-core size, for example installing its dependencies and re-running the measurement",
      // Worded around the CLAIM, not the vocabulary. The first version ("supplied in the request
      // rather than measured by the collector script") produced a false FAIL: the model wrote
      // "Numbers are measured from the supplied manifests…", which attributes the provenance
      // correctly, but the judge caught on the word "measured" and scored it against us.
      "the Scope section attributes the numbers to the data supplied in the request, and does not claim to have run the collector script or any other command to obtain them",
    ],
    threshold: 0.75,
    maxTurns: 10,
  },
];
