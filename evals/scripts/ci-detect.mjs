/**
 * CI change detector for the harness evals.
 *
 * Reads a newline-separated list of changed files (repo-relative) from $CHANGED_FILES and maps
 * them onto the eval suites that should run for this PR:
 *
 *   .claude/skills/<name>/**   OR  evals/skills/<name>/**   → run evals/skills/<name>  (content tier)
 *   .claude/agents/<name>.md   OR  evals/agents/<name>/**   → run evals/agents/<name>  (tool tier)
 *   any AGENTS.md / CLAUDE.md, any agent definition, or the engine → run the workflow tier
 *
 * Three routing rules here are load-bearing and none of them is obvious:
 *
 * 1. The workflow trigger matches `AGENTS.md` at ANY depth, not just `CLAUDE.md`. In this repo
 *    `CLAUDE.md` is a two-line `@AGENTS.md` import that holds no content (root AGENTS.md says so),
 *    every rule lives in an `AGENTS.md`, and `evals/workflow/review-workflow.cases.ts` asserts on
 *    `server/AGENTS.md` and `client/AGENTS.md` BY NAME. A detector keyed on the literal string
 *    "CLAUDE.md" therefore never fires on the ruleset actually changing — it would have shipped as
 *    a trigger that cannot trigger.
 *
 * 2. `.claude/agents/README.md` is the agents CATALOG, not an agent. It matches the agent-name
 *    shape (`README`), so without a guard a docs-only edit dispatches the model-backed workflow
 *    tier and prints a nonsense `SKIP README (no evals)`.
 *
 * 3. The frozen half of an A/B pair (`src/artifacts/pairs.ts`) is deliberately DEGRADED and is
 *    graded against its source's own cases and threshold — scoring lower IS the measurement. It
 *    must never enter a blocking matrix. Editing either half is already caught, for free, by
 *    `checkPairs()` in the zero-token `pnpm eval:quality` gate.
 *
 * A changed artifact with NO written evals is NOT a failure: it is reported on the `skipped_*`
 * outputs, and this script writes its own `SKIP <name> (<reason>)` lines into the step summary so
 * the decision is visible where a human already looks.
 *
 * Emits GitHub Actions step outputs (skills, agents, run_workflow, skipped_skills, skipped_agents)
 * to $GITHUB_OUTPUT. Pure filesystem + string work, no deps — so the CI job that runs it needs no
 * `pnpm install`. Importing this file has no side effects (see the main-module guard at the foot);
 * `src/ci-detect.test.ts` drives `detectSuites()` directly.
 */

import { existsSync, readdirSync, readFileSync, appendFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const EVALS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Does evals/<tier>/<name>/ contain at least one *.eval.ts? */
export function hasEvalsOnDisk(tier, name) {
  const dir = join(EVALS_DIR, tier, name);
  if (!existsSync(dir)) return false;
  return readdirSync(dir).some((f) => f.endsWith(".eval.ts"));
}

/**
 * The frozen variants of the A/B pairs, scraped from `src/artifacts/pairs.ts` as TEXT.
 *
 * Scraped rather than imported because this script is deliberately dependency-free plain `.mjs`
 * (no tsx, no install in the `detect` job) and `pairs.ts` is TypeScript. `pairs.ts` stays the ONE
 * place a pair is declared; duplicating the list here is how the two would drift.
 *
 * Fails OPEN: if the scrape finds nothing, nothing is excluded. A silent empty list must degrade
 * to "run everything" (a job that is red by design) rather than to "run nothing" (a blocking
 * matrix that quietly stops covering agents).
 */
export function abVariantsOnDisk() {
  try {
    const src = readFileSync(join(EVALS_DIR, "src", "artifacts", "pairs.ts"), "utf8");
    return [...src.matchAll(/^\s*variant:\s*"([^"]+)"/gm)].map((m) => m[1]);
  } catch {
    return [];
  }
}

/** Collect distinct artifact names touched under a `.claude` and/or `evals` prefix. */
function touched(changed, reClaude, reEvals) {
  const names = new Set();
  for (const f of changed) {
    const m = f.match(reClaude) ?? f.match(reEvals);
    if (m) names.add(m[1]);
  }
  return [...names].sort();
}

/**
 * The whole mapping, as a pure function — injected `hasEvals` / `abVariants` so the test drives it
 * without a filesystem. Returns the five step outputs plus the human-readable skip lines.
 */
export function detectSuites({ changed, hasEvals = hasEvalsOnDisk, abVariants = abVariantsOnDisk() }) {
  const isAgentDefinition = (f) => /^\.claude\/agents\/.+\.md$/.test(f) && basename(f) !== "README.md";

  const skillNames = touched(changed, /^\.claude\/skills\/([^/]+)\//, /^evals\/skills\/([^/]+)\//);
  const agentNames = touched(
    changed.filter((f) => !f.startsWith(".claude/agents/") || isAgentDefinition(f)),
    /^\.claude\/agents\/([^/]+)\.md$/,
    /^evals\/agents\/([^/]+)\//,
  );

  const skills = skillNames.filter((n) => hasEvals("skills", n));
  const skipped = [
    ...skillNames.filter((n) => !hasEvals("skills", n)).map((n) => ({ tier: "skill", name: n, reason: "no evals" })),
  ];

  const agents = [];
  for (const n of agentNames) {
    if (abVariants.includes(n)) skipped.push({ tier: "agent", name: n, reason: "A/B baseline" });
    else if (!hasEvals("agents", n)) skipped.push({ tier: "agent", name: n, reason: "no evals" });
    else agents.push(n);
  }

  // The workflow tier measures the LIVE harness, so anything that changes it re-triggers it: any
  // AGENTS.md or CLAUDE.md at any depth (rule 1 in the header), any agent DEFINITION (rule 2), the
  // workflow cases, or the engine itself.
  const runWorkflow = changed.some(
    (f) =>
      /(^|\/)(AGENTS|CLAUDE)\.md$/.test(f) ||
      isAgentDefinition(f) ||
      /^evals\/workflow\//.test(f) ||
      /^evals\/src\//.test(f),
  );

  return {
    skills,
    agents,
    runWorkflow,
    skippedSkills: skipped.filter((s) => s.tier === "skill").map((s) => s.name),
    skippedAgents: skipped.filter((s) => s.tier === "agent").map((s) => s.name),
    skipLines: skipped.map((s) => `SKIP ${s.tier} ${s.name} (${s.reason})`),
  };
}

function main() {
  const changed = (process.env.CHANGED_FILES ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const r = detectSuites({ changed });

  const out = process.env.GITHUB_OUTPUT;
  const write = (k, v) => (out ? appendFileSync(out, `${k}=${v}\n`) : console.log(`${k}=${v}`));

  write("skills", JSON.stringify(r.skills));
  write("agents", JSON.stringify(r.agents));
  write("run_workflow", String(r.runWorkflow));
  write("skipped_skills", r.skippedSkills.join(" "));
  write("skipped_agents", r.skippedAgents.join(" "));

  // Human-readable summary in the step log AND in the job summary — a skip has to be visible
  // somewhere a human already looks, not only in a collapsed step log.
  const lines = [
    "── eval change detection ──",
    `changed files : ${changed.length}`,
    `skills → run  : ${r.skills.join(", ") || "(none)"}`,
    `agents → run  : ${r.agents.join(", ") || "(none)"}`,
    `workflow tier : ${r.runWorkflow ? "run" : "skip"}`,
    ...r.skipLines,
  ];
  for (const l of lines) console.error(l);

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `### eval routing\n\n\`\`\`\n${lines.join("\n")}\n\`\`\`\n`);
}

// Side-effect free on import: only run when this file IS the entrypoint.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
