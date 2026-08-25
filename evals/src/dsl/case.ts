/**
 * Case types + the runners that turn a data array into vitest tests. This module owns the ONE
 * true measure → (log) → assert body, so case authors never rewrite it — which is exactly what
 * keeps the "assert before record" bug from recurring once record() lands (T2 slots into the
 * marked spot below, in this one file).
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vitest";
import { DEFAULT_THRESHOLD } from "../config.js";
import { skillTask, agentTask, workflowTask } from "../tasks.js";
import { runClaude, failedResult, type Result, type RunOptions } from "../runtime/run-claude.js";
import { patternMatch } from "../scoring/pattern-match.js";
import { llmJudge, type Verdict } from "../scoring/llm-judge.js";
import { logTrace, logVerdict } from "../logging/log.js";
import { record } from "../records/record.js";

// --- Case shapes ------------------------------------------------------------

/** A judge-and-grounding case. Same shape for skills and agents; only the task differs. */
export interface QualityCase {
  name: string;
  kind?: "quality" | "grounding";
  prompt: string;
  /** Practices the judge scores (quality). Omit for a pure grounding case. */
  practices?: string[];
  /** Substrings that must ALL appear before the judge runs (cheap-tier gate). */
  grounding?: string[];
  /** Judge score gate (default 0.6). */
  threshold?: number;
  maxTurns?: number;
}
export type SkillCase = QualityCase;
export type AgentCase = QualityCase;

/** A trace-asserted workflow case — a discriminated union routed by `kind`. */
export type WorkflowCase =
  | { kind: "dispatch"; name: string; prompt: string; expectSubagent: string; maxTurns?: number }
  | {
      kind: "activation";
      name: string;
      prompt: string;
      skill: string;
      shouldActivate: boolean;
      /**
       * Also assert the session dispatched NO subagent. Free to add — a negative case already
       * pays for a session in which nothing was supposed to fire, so it may as well assert the
       * other over-firing this harness is prone to (delegating an explain-shaped prompt).
       */
      forbidSubagents?: boolean;
      maxTurns?: number;
    }
  | {
      kind: "contrast";
      name: string;
      prompt: string;
      expectFileRead: string;
      tools?: string[];
      maxTurns?: number;
    }
  | {
      // A single-session composite: run ONE workflowTask and assert several trace facets at once.
      // Cheaper than separate dispatch/activation/contrast cases (one session, not N) at the cost
      // of coarser diagnostics and no control run — use contrast when you must isolate CLAUDE.md's
      // contribution. Every provided expectation must hold; omitted fields are not checked.
      kind: "trace";
      name: string;
      prompt: string;
      expectSubagents?: string[];
      expectSkills?: string[];
      expectFilesRead?: string[];
      /**
       * Substrings that must ALL appear in the final text (case-insensitive, via patternMatch).
       *
       * The trace cannot see a rule that arrives as CONFIG rather than as a `Read`: the root
       * CLAUDE.md is loaded by settingSources, and a package CLAUDE.md is injected by the harness
       * when work touches that subtree — neither produces a tool call. The only evidence such a
       * file took effect is a rule appearing in the answer that the model could not otherwise
       * know. Pick markers that are literal repo tokens (`pnpm arch`, `devdigest_pgdata`), not
       * paraphrasable prose.
       *
       * Presence of this field DISABLES the early stop — see the runner.
       */
      expectMentions?: string[];
      maxTurns?: number;
    };

/**
 * Did a skill engage? Either an explicit Skill tool-call, or reading its SKILL.md.
 *
 * Takes a PARTIAL trace so the same rule answers the question mid-session (inside `stopWhen`) and
 * after it (`activated`). Two copies of this predicate is how an early stop starts disagreeing
 * with the assertion it was supposed to anticipate.
 */
const engagedIn = (p: Pick<Result, "skillsInvoked" | "filesRead">, skill: string): boolean =>
  p.skillsInvoked.some((s) => s === skill || s.endsWith(`:${skill}`)) ||
  p.filesRead.some((f) => f.includes(`skills/${skill}/SKILL.md`));

export const activated = (result: Result, skill: string): boolean => engagedIn(result, skill);

// --- Runners ----------------------------------------------------------------

type Task = (prompt: string, artifact: string, opts?: RunOptions) => Promise<Result>;

/**
 * Run the model call so that a THROWN run still lands in the series.
 *
 * record() lives in a `finally` further down, but the task call that feeds it sits before the
 * try — so an SDK error (throttling, a dead session) produced no row at all and the case simply
 * vanished from that run. `repeat` kept reporting `times: 5` while one case held 4 rows and
 * another 3, and `delta` put those rates next to each other as if the denominators matched.
 *
 * The failure is recorded as a failure and then rethrown unchanged, so the test still goes red
 * with its original error — this widens what gets measured, it does not swallow anything.
 */
async function runOrRecordFailure(label: string, threshold: number | undefined, run: () => Promise<Result>): Promise<Result> {
  try {
    return await run();
  } catch (err) {
    record(label, { result: failedResult(err), threshold });
    throw err;
  }
}

function runQualityCases(artifact: string, cases: QualityCase[], task: Task): void {
  for (const c of cases) {
    test(c.name, async () => {
      const threshold = c.threshold ?? DEFAULT_THRESHOLD;
      const result = await runOrRecordFailure(c.name, threshold, () =>
        task(c.prompt, artifact, { maxTurns: c.maxTurns }),
      );
      logTrace(c.name, result);

      // measure → record → assert. Everything measurable runs in the try; record() fires in the
      // finally with whatever accumulated; the asserts happen strictly after. A failing config
      // (e.g. baseline: grounding gate fails, judge skipped) still leaves a record.
      let grounded: number | undefined;
      let verdict: Verdict | undefined;
      try {
        // Cheap deterministic tier first — the grounding gate. When it fails the judge is skipped.
        if (c.grounding?.length) grounded = patternMatch(result.text, c.grounding);
        if (c.practices?.length && (grounded === undefined || grounded === 1)) {
          verdict = await llmJudge(result.text, c.practices);
          logVerdict(c.name, verdict);
        }
      } finally {
        record(c.name, { result, verdict, grounded, threshold });
      }

      if (grounded !== undefined) {
        expect(grounded, `missing concrete evidence; output:\n${result.text}`).toBe(1);
      }
      if (verdict) {
        expect(verdict.score, JSON.stringify(verdict.results)).toBeGreaterThanOrEqual(threshold);
      }
    });
  }
}

export const runSkillCases = (skill: string, cases: SkillCase[]) => runQualityCases(skill, cases, skillTask);
export const runAgentCases = (agent: string, cases: AgentCase[]) => runQualityCases(agent, cases, agentTask);

export function runWorkflowCases(cases: WorkflowCase[]): void {
  for (const c of cases) {
    test(c.name, async () => {
      if (c.kind === "dispatch") {
        // Stop the moment the subagent is launched — no need to wait out its nested session.
        const expect1 = c.expectSubagent;
        const result = await runOrRecordFailure(c.name, undefined, () =>
          workflowTask(c.prompt, {
            maxTurns: c.maxTurns,
            stopWhen: (p) => p.subagents.includes(expect1),
          }),
        );
        logTrace(c.name, result);
        // The recorded outcome is the ASSERTION's verdict, computed here rather than inferred from
        // the run's exit state — see RecordData.outcome for what inferring it cost.
        const dispatched = result.subagents.includes(c.expectSubagent);
        try {
          expect(result.subagents, `subagents: ${result.subagents.join(", ")}`).toContain(c.expectSubagent);
        } finally {
          record(c.name, { result, outcome: dispatched });
        }
      } else if (c.kind === "activation") {
        // The verdict is settled the moment the skill engages: either it was supposed to (the
        // assert holds) or it was not (the assert has already failed). Everything after that is
        // paid-for turns with nothing to measure — and not merely wasteful. The positive
        // engineering-insights case, left to run on, did what the skill says to do and WROTE its
        // synthetic pgvector finding into the repo's own server/INSIGHTS.md (measured
        // 2026-08-25). The deny-list stops the main session; it does not stop a dispatched
        // subagent, which is why a forbidden dispatch ends the session here too.
        const result = await runOrRecordFailure(c.name, undefined, () =>
          workflowTask(c.prompt, {
            maxTurns: c.maxTurns,
            stopWhen: (p) =>
              engagedIn(p, c.skill) || (c.forbidSubagents === true && p.subagents.length > 0),
          }),
        );
        logTrace(c.name, result);
        // Deliberately NOT gated on `isError`: an activation case asserts what the session did or
        // did not engage, and a run that exceeded its turn budget can still have answered that
        // question. Folding the exit state in is what marked a correct near-miss negative 0/2.
        const passed =
          activated(result, c.skill) === c.shouldActivate &&
          (!c.forbidSubagents || result.subagents.length === 0);
        try {
          expect(
            activated(result, c.skill),
            `skills: ${result.skillsInvoked.join(", ")} | reads: ${result.filesRead.join(", ")}`,
          ).toBe(c.shouldActivate);
          if (c.forbidSubagents) {
            expect(result.subagents, `subagents: ${result.subagents.join(", ")}`).toEqual([]);
          }
        } finally {
          record(c.name, { result, outcome: passed });
        }
      } else if (c.kind === "trace") {
        // One session, many asserts — every provided expectation is checked against the same trace.
        // Stop as soon as ALL expectations are satisfied (e.g. doc read + subagent launched), so a
        // dispatch-bearing trace doesn't pay for the nested subagent's full run.
        const subs = c.expectSubagents ?? [];
        const skls = c.expectSkills ?? [];
        const files = c.expectFilesRead ?? [];
        // Early stop breaks the message loop at a tool_use, BEFORE the result message that carries
        // the final answer — `result.text` is then only the assistant text accumulated so far. A
        // case that asserts on that text must therefore run to completion, or it fails on an
        // answer the session never got to write. Tool-only cases keep the saving.
        const wantsText = (c.expectMentions?.length ?? 0) > 0;
        const result = await runOrRecordFailure(c.name, undefined, () =>
          workflowTask(c.prompt, {
            maxTurns: c.maxTurns,
            stopWhen: wantsText
              ? undefined
              : (p) =>
                  subs.every((s) => p.subagents.includes(s)) &&
                  skls.every((s) => engagedIn(p, s)) &&
                  files.every((f) => p.filesRead.some((r) => r.includes(f))),
          }),
        );
        logTrace(c.name, result);
        let grounded: number | undefined;
        // Every facet evaluated up front, so the recorded outcome is the same conjunction the
        // asserts below check — including `isError`, which a trace case does assert on.
        if (c.expectMentions?.length) grounded = patternMatch(result.text, c.expectMentions);
        const passed =
          subs.every((s) => result.subagents.includes(s)) &&
          skls.every((s) => activated(result, s)) &&
          files.every((f) => result.filesRead.some((r) => r.includes(f))) &&
          (grounded === undefined || grounded === 1) &&
          !result.isError;
        try {
          for (const sub of c.expectSubagents ?? []) {
            expect(result.subagents, `subagents: ${result.subagents.join(", ")}`).toContain(sub);
          }
          for (const skill of c.expectSkills ?? []) {
            expect(
              activated(result, skill),
              `skill ${skill} not engaged | skills: ${result.skillsInvoked.join(", ")} | reads: ${result.filesRead.join(", ")}`,
            ).toBe(true);
          }
          for (const file of c.expectFilesRead ?? []) {
            expect(
              result.filesRead.some((f) => f.includes(file)),
              `${file} not read | reads: ${result.filesRead.join(", ")}`,
            ).toBe(true);
          }
          if (c.expectMentions?.length) {
            const missing = c.expectMentions.filter(
              (m) => !result.text.toLowerCase().includes(m.toLowerCase()),
            );
            expect(grounded, `missing mentions: ${missing.join(", ")}\noutput:\n${result.text}`).toBe(1);
          }
          expect(result.isError).toBe(false);
        } finally {
          // `grounded` rides along so a mentions-bearing trace is a MEASURED series (repeat/delta
          // can show the coverage drifting), not just a red/green test.
          record(c.name, { result, grounded, outcome: passed });
        }
      } else {
        // contrast: treatment (real harness) vs control (empty tmpdir, no on-disk config).
        const tools = c.tools ?? ["Read", "Grep", "Glob"];
        const treatment = await runOrRecordFailure(`${c.name} [treatment]`, undefined, () =>
          workflowTask(c.prompt, { allowedTools: tools, maxTurns: c.maxTurns }),
        );
        const emptyCwd = mkdtempSync(join(tmpdir(), "eval-control-"));
        let control: Result;
        try {
          control = await runClaude(c.prompt, {
            allowedTools: tools,
            maxTurns: c.maxTurns,
            cwd: emptyCwd,
            settingSources: [],
          });
        } catch (err) {
          // Written out rather than routed through the helper: the treatment half already
          // succeeded, and a contrast case is only readable as a PAIR. Recording the control
          // failure alone would leave a treatment row with nothing to contrast against.
          record(`${c.name} [treatment]`, { result: treatment });
          record(`${c.name} [control]`, { result: failedResult(err) });
          throw err;
        }
        logTrace(`${c.name} [treatment]`, treatment);
        logTrace(`${c.name} [control]`, control);
        const treatmentRead = treatment.filesRead.some((f) => f.includes(c.expectFileRead));
        const controlRead = control.filesRead.some((f) => f.includes(c.expectFileRead));
        try {
          expect(treatmentRead, `treatment reads: ${treatment.filesRead.join(", ")}`).toBe(true);
          expect(controlRead, `control reads: ${control.filesRead.join(", ")}`).toBe(false);
        } finally {
          // Each row carries what ITS half was supposed to show: the treatment reads the file,
          // the control does not. A control that stayed clean is a passing control.
          record(`${c.name} [treatment]`, { result: treatment, outcome: treatmentRead });
          record(`${c.name} [control]`, { result: control, outcome: !controlRead });
        }
      }
    });
  }
}
