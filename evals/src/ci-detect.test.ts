/**
 * The CI change detector, as a test — no model, no network, no filesystem.
 *
 * This lives in the model-free lane on purpose. `vitest.config.ts` splits on `**\/*.eval.ts`
 * (model-backed, bills tokens) vs `src/**\/*.test.ts` (free), and this file must never land in the
 * billing lane: it is the cheapest possible check of the logic that decides how much the OTHER
 * lanes get to spend.
 *
 * `detectSuites()` takes `hasEvals` and `abVariants` as parameters so every row below is a pure
 * string→outputs assertion. The one row that does touch disk is the last: it pins that the real
 * `pairs.ts` is still scrapeable, because that scrape fails OPEN and a silent empty list would
 * quietly put a deliberately-degraded artifact back into a blocking matrix.
 */

import { describe, it, expect } from "vitest";
import { detectSuites, abVariantsOnDisk } from "../scripts/ci-detect.mjs";

/** The artifacts that actually have evals today; every other name is a legitimate SKIP. */
const hasEvals = (tier: string, name: string): boolean =>
  (tier === "skills" && name === "dependency-checker") ||
  (tier === "agents" && (name === "architecture-reviewer" || name === "architecture-reviewer-lite"));

const abVariants = ["architecture-reviewer-lite"];
const detect = (changed: string[]) => detectSuites({ changed, hasEvals, abVariants });

interface Row {
  what: string;
  changed: string[];
  skills?: string[];
  agents?: string[];
  runWorkflow: boolean;
  skippedSkills?: string[];
  skippedAgents?: string[];
}

const rows: Row[] = [
  // --- the workflow trigger. The first three are the whole reason this file exists: the shipped
  // detector matched only the literal "CLAUDE.md", which in this repo is a 2-line @AGENTS.md
  // import — so the rules moving never fired the tier that measures the rules.
  { what: "a package AGENTS.md fires the workflow tier", changed: ["server/AGENTS.md"], runWorkflow: true },
  { what: "the client's AGENTS.md too", changed: ["client/AGENTS.md"], runWorkflow: true },
  { what: "the root CLAUDE.md import still counts", changed: ["CLAUDE.md"], runWorkflow: true },
  { what: "the engine fires the workflow tier", changed: ["evals/src/runtime/env.ts"], runWorkflow: true },
  { what: "the workflow cases fire it", changed: ["evals/workflow/review-workflow.cases.ts"], runWorkflow: true },
  { what: "an unrelated root doc fires nothing", changed: ["README.md"], runWorkflow: false },
  { what: "an ordinary source file fires nothing", changed: ["server/src/index.ts"], runWorkflow: false },

  // --- skills
  {
    what: "a skill WITH evals is routed to the matrix",
    changed: [".claude/skills/dependency-checker/SKILL.md"],
    skills: ["dependency-checker"],
    runWorkflow: false,
  },
  {
    what: "a skill WITHOUT evals is a SKIP, not a failure and not a run",
    changed: [".claude/skills/zod/SKILL.md"],
    skills: [],
    skippedSkills: ["zod"],
    runWorkflow: false,
  },
  {
    what: "editing the eval case file routes the skill too",
    changed: ["evals/skills/dependency-checker/dependency-checker.cases.ts"],
    skills: ["dependency-checker"],
    runWorkflow: false,
  },
  {
    what: "the skills catalog is not a skill",
    changed: [".claude/skills/README.md"],
    skills: [],
    skippedSkills: [],
    runWorkflow: false,
  },

  // --- agents
  {
    what: "an agent WITH evals runs, and also fires the workflow tier",
    changed: [".claude/agents/architecture-reviewer.md"],
    agents: ["architecture-reviewer"],
    runWorkflow: true,
  },
  {
    what: "an agent WITHOUT evals is a SKIP but still fires the workflow tier",
    changed: [".claude/agents/doc-writer.md"],
    agents: [],
    skippedAgents: ["doc-writer"],
    runWorkflow: true,
  },
  {
    what: "the A/B baseline is excluded from the blocking matrix, with its own reason",
    changed: [".claude/agents/architecture-reviewer-lite.md"],
    agents: [],
    skippedAgents: ["architecture-reviewer-lite"],
    runWorkflow: true,
  },
  {
    what: "the agents catalog is neither an agent nor a workflow trigger",
    changed: [".claude/agents/README.md"],
    agents: [],
    skippedAgents: [],
    runWorkflow: false,
  },

  // --- combinations and hostile input
  {
    what: "a mixed PR routes every tier at once",
    changed: [".claude/skills/dependency-checker/SKILL.md", ".claude/agents/architecture-reviewer.md", "AGENTS.md"],
    skills: ["dependency-checker"],
    agents: ["architecture-reviewer"],
    runWorkflow: true,
  },
  {
    what: "an empty change set routes nothing",
    changed: [],
    skills: [],
    agents: [],
    runWorkflow: false,
  },
  {
    what: "a filename with a space or a quote is data, not a crash",
    changed: ['docs/a file "with" quotes.md', "$(rm -rf /).md", ".claude/skills/dependency-checker/SKILL.md"],
    skills: ["dependency-checker"],
    runWorkflow: false,
  },
];

describe("ci-detect", () => {
  for (const r of rows) {
    it(r.what, () => {
      const got = detect(r.changed);
      if (r.skills) expect(got.skills).toEqual(r.skills);
      if (r.agents) expect(got.agents).toEqual(r.agents);
      if (r.skippedSkills) expect(got.skippedSkills).toEqual(r.skippedSkills);
      if (r.skippedAgents) expect(got.skippedAgents).toEqual(r.skippedAgents);
      expect(got.runWorkflow).toBe(r.runWorkflow);
    });
  }

  it("names the reason on every skip line", () => {
    const got = detect([".claude/skills/zod/SKILL.md", ".claude/agents/architecture-reviewer-lite.md"]);
    expect(got.skipLines).toEqual([
      "SKIP skill zod (no evals)",
      "SKIP agent architecture-reviewer-lite (A/B baseline)",
    ]);
  });

  // The scrape fails open, so "found nothing" is indistinguishable from "no pairs declared" at
  // runtime. This is the row that notices when pairs.ts is reshaped and the regex stops matching.
  it("still finds the declared A/B variants in the real pairs.ts", () => {
    expect(abVariantsOnDisk()).toContain("architecture-reviewer-lite");
  });

  // route-all is what a manual run uses: workflow_dispatch has no diff, so without it the model
  // override has no target. It must widen the TRIGGER without widening what is eligible.
  describe("route-all (manual run)", () => {
    const listArtifacts = (tier: string) =>
      tier === "skills"
        ? ["dependency-checker", "half-written-skill"]
        : ["architecture-reviewer", "architecture-reviewer-lite", "doc-writer"];
    const all = () => detectSuites({ changed: [], all: true, hasEvals, abVariants, listArtifacts });

    it("routes every artifact that has evals, from an empty change set", () => {
      expect(all().skills).toEqual(["dependency-checker"]);
      expect(all().agents).toEqual(["architecture-reviewer"]);
    });

    it("always runs the workflow tier", () => {
      expect(all().runWorkflow).toBe(true);
    });

    it("still excludes what the diff path excludes — no evals, and the A/B baseline", () => {
      expect(all().skippedSkills).toEqual(["half-written-skill"]);
      expect(all().skippedAgents).toEqual(["architecture-reviewer-lite", "doc-writer"]);
    });
  });
});
