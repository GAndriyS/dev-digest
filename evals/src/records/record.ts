/**
 * Persist one eval run. Every case — passing OR failing — leaves a durable record: the verdict
 * with its per-practice evidence, the grounding result, resource metrics, the trace, git
 * provenance, and the configuration it ran under. The full model output is written alongside so
 * it can be re-read (or re-judged) later instead of being thrown away.
 *
 * `results/` is gitignored and append-only — deleting it is always safe.
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";
import { EVAL_CONFIG } from "../config.js";
import { RESULTS_DIR } from "../artifacts/paths.js";
import { gitInfo } from "../git.js";
import type { Result } from "../runtime/run-claude.js";
import type { Verdict } from "../scoring/llm-judge.js";

const RECORDS = join(RESULTS_DIR, "records.jsonl");
const OUTPUTS = join(RESULTS_DIR, "outputs");

// One id per process (per vitest run), same format as the trend reporter.
const RUN_ID = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
const { sha: GIT_SHA, dirty: DIRTY } = gitInfo();

const slugify = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "case";

export interface RecordData {
  result: Result;
  verdict?: Verdict;
  grounded?: number;
  threshold?: number;
  extra?: Record<string, unknown>;
}

/**
 * Append a record for the currently-running test. Call from a `finally` so it fires even when
 * the assertions that follow it throw — that is what keeps a failing configuration's series
 * from being silently empty.
 */
export function record(label: string, data: RecordData): void {
  const { result, verdict, grounded, threshold, extra } = data;
  const state = expect.getState();
  // The TEST NAME comes from the caller, never from vitest's ambient state.
  //
  // `currentTestName` is ambient and mutable, and this function fires from a `finally` after a
  // 40-70s model call. By then it has been observed pointing at a NEIGHBOURING case, so records
  // were filed under the wrong test: in one 5-run series a single test collected 6 records while
  // another collected 0, and each per-practice rate was then computed over a denominator
  // belonging to some other case. Every multi-run statistic in this package — repeat, delta,
  // benchmark — was silently affected (measured 2026-08-25).
  //
  // The SUITE prefix ("agent:architecture-reviewer") is still taken from the ambient name, which
  // is safe: it is the same for every case in a file, so a stale read yields the right prefix
  // anyway. Only the trailing test name is replaced with the label the caller passed in.
  const ambient = state.currentTestName ?? "";
  const suite = ambient.includes(" > ") ? ambient.slice(0, ambient.lastIndexOf(" > ")) : "";
  const nodeid = `${state.testPath ?? "?"} > ${suite ? `${suite} > ` : ""}${label}`;

  // outcome: grounding gate failure short-circuits to false; else the judge threshold; else
  // "did the run itself succeed" (workflow tests have neither grounding nor a judge verdict).
  const outcome =
    grounded !== undefined && grounded < 1
      ? false
      : verdict && threshold !== undefined
        ? verdict.score >= threshold
        : !result.isError;

  const outDir = join(OUTPUTS, RUN_ID);
  mkdirSync(outDir, { recursive: true });
  const outputFile = join("outputs", RUN_ID, `${slugify(label)}.md`);
  writeFileSync(join(RESULTS_DIR, outputFile), result.text);

  const row = {
    schema: 1,
    run_id: RUN_ID,
    git_sha: GIT_SHA,
    dirty: DIRTY,
    config: EVAL_CONFIG,
    nodeid,
    label,
    outcome,
    score: verdict?.score,
    threshold,
    practices: verdict?.results ?? [],
    grounded,
    num_turns: result.numTurns,
    metrics: result.metrics,
    trace: {
      tools: result.toolsUsed,
      subagents: result.subagents,
      skills: result.skillsInvoked,
      reads: result.filesRead,
    },
    output_file: outputFile,
    ...extra,
  };

  mkdirSync(RESULTS_DIR, { recursive: true });
  appendFileSync(RECORDS, JSON.stringify(row) + "\n");
}
