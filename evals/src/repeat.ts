/**
 * Run the same eval pattern N times to measure stability (LLM evals are probabilistic — one
 * green run proves little). Wraps `vitest run`, so vitest flags (-t, path patterns) pass through;
 * only -n/--times and --label are consumed here. Aggregates the records written during the runs
 * into per-test pass rate, a per-practice breakdown, and metric stats (mean ± stddev).
 *
 *   pnpm eval:repeat skills/onion-architecture --label baseline
 *
 * -n defaults to MAX_REPEATS and cannot exceed it (2 unless EVAL_MAX_REPEATS raises it) — a delta
 * drawn from n=2 is noise, so an A/B has to opt into the cost explicitly.
 *
 * --label saves the aggregate to results/repeat-<label>.json so two labeled series can be diffed
 * with `pnpm eval:delta baseline candidate`.
 */

import { mkdirSync, writeFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { GREEN, RED, YELLOW, DIM, RESET, rateColor } from "./ansi.js";
import { gitInfo } from "./git.js";
import { FLAKY_LOW, FLAKY_HIGH, MAX_REPEATS } from "./config.js";
import { countTests, runVitestOnce } from "./run-vitest.js";
import { RESULTS_DIR } from "./artifacts/paths.js";
import { aggregate, loadRecords, recordCount, type NodeAggregate, type Stats } from "./records/stats.js";

/**
 * vitest treats a path pattern as a SUBSTRING filter, so a bare `agents/architecture-reviewer`
 * also matches `agents/architecture-reviewer-lite/...` and silently doubles the run with the
 * wrong agent. Expand any positional arg that points at a directory into the exact `.eval.ts`
 * file paths inside it (which are NOT substrings of a sibling directory's files), so an A/B stays
 * a clean A/B. Args that already name a file, or that don't resolve to a directory, pass through.
 */
function resolveEvalPatterns(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    // Preserve flags and the value that follows a value-taking flag (e.g. -t <pattern>).
    if (a.startsWith("-")) {
      out.push(a);
      if (a === "-t" || a === "--testNamePattern") out.push(args[++i]);
      continue;
    }
    if (existsSync(a) && statSync(a).isDirectory()) {
      const evals = readdirSync(a)
        .filter((f) => f.endsWith(".eval.ts"))
        .map((f) => join(a, f));
      if (evals.length) {
        out.push(...evals);
        continue;
      }
    }
    out.push(a);
  }
  return out;
}

const pct = (rate: number) => `${Math.round(rate * 100)}%`;
const statLine = (label: string, s: Stats) =>
  `      ${label}: ${s.mean.toFixed(0)} ± ${s.stddev.toFixed(0)} [${s.min}–${s.max}]`;

// Strict interior of the band: 0% and 100% are stable verdicts, everything between at n≥2 is a
// case that flips run to run. Same constants the delta analyst flags use (config.ts).
const isFlaky = (rate: number, n: number): boolean => n >= 2 && rate > FLAKY_LOW && rate < FLAKY_HIGH;

function printTest(agg: NodeAggregate, times: number): void {
  const shortId = agg.nodeid.split(" > ").slice(-1)[0];
  // FLAKY is a distinct verdict, not a softer red: a 40% case needs more n or a case fix, while
  // a 0% case needs the artifact fixed. Tagging the band keeps the two from reading alike.
  const flakyTag = isFlaky(agg.pass.rate, agg.pass.total) ? ` ${YELLOW}FLAKY${RESET}` : "";
  console.log(`\n  ${rateColor(agg.pass.rate)}${agg.pass.passed}/${agg.pass.total} ${pct(agg.pass.rate)}${RESET}${flakyTag}  ${shortId}`);
  const practices = Object.entries(agg.practices);
  if (practices.length) {
    for (const [text, s] of practices) {
      const pFlaky = isFlaky(s.rate, s.total) ? ` ${YELLOW}FLAKY${RESET}` : "";
      console.log(`      ${rateColor(s.rate)}${s.passed}/${s.total} ${pct(s.rate).padStart(4)}${RESET}${pFlaky}  ${text}`);
    }
  }
  console.log(statLine("turns   ", agg.metrics.numTurns));
  console.log(statLine("duration", agg.metrics.durationMs));
  console.log(statLine("tok_out ", agg.metrics.outputTokens));
  // Invalid runs are shown, never averaged: the rates above are over valid rows only.
  if (agg.invalid > 0) {
    console.log(`      ${YELLOW}${agg.invalid} invalid run(s) (zero-turn timeout) excluded from the rates above${RESET}`);
  }
  // Caveat on the ACTUAL row count, not on what was requested. A case that lost runs to a dead
  // session is the one whose stddev deserves the caveat most, and it is exactly the case that
  // used to escape it by being counted at the requested n.
  const n = agg.pass.total;
  const missing = times - n - agg.invalid;
  if (missing > 0) {
    console.log(`      ${RED}n=${n} of ${times} requested — ${missing} run(s) produced no record${RESET}`);
  }
  if (n < 5) console.log(`      ${DIM}(n=${n}: stddev indicative only)${RESET}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  // Default AND cap both come from MAX_REPEATS (2 unless EVAL_MAX_REPEATS says otherwise) — see
  // config.ts for what n=2 buys and what it costs. `-n` can only lower the number, never raise it
  // past the cap, so a mistyped flag cannot spend a session it was not budgeted.
  const DEFAULT_TIMES = MAX_REPEATS;
  const MAX_TIMES = MAX_REPEATS;
  let times = DEFAULT_TIMES;
  let label: string | undefined;
  const vitestArgs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-n" || a === "--times") times = Number(argv[++i]);
    else if (a === "--label") label = argv[++i];
    else vitestArgs.push(a);
  }
  if (vitestArgs.length === 0 || !Number.isFinite(times) || times < 1) {
    console.error(
      `usage: pnpm eval:repeat <vitest pattern> [-n times<=${MAX_TIMES}, default ${DEFAULT_TIMES}] [-t testNamePattern] [--label name]`,
    );
    process.exit(1);
  }
  if (times > MAX_TIMES) {
    console.error(
      `  ${DIM}capping -n ${times} → ${MAX_TIMES} (token economy; raise with EVAL_MAX_REPEATS=${times})${RESET}`,
    );
    times = MAX_TIMES;
  }
  vitestArgs.splice(0, vitestArgs.length, ...resolveEvalPatterns(vitestArgs));

  const startLine = recordCount();
  let line = startLine;
  const nCases = countTests(vitestArgs);
  console.log(`\nRepeat: ${vitestArgs.join(" ")}`);
  console.log(`  ${nCases ?? "?"} test case(s) × ${times} runs  (full traces in results/outputs/)\n`);
  for (let i = 1; i <= times; i++) {
    const captured = await runVitestOnce(`run ${i}/${times}`, vitestArgs);
    const fresh = loadRecords(line);
    line = recordCount();
    if (fresh.length === 0) {
      console.log(`  run ${i}/${times}  ${RED}no records — run crashed${RESET}`);
      if (captured) console.log(captured.split("\n").slice(-6).join("\n"));
      continue;
    }
    const measured = fresh.filter((r) => r.valid !== false);
    const invalid = fresh.length - measured.length;
    const passed = measured.filter((r) => r.outcome).length;
    const mark = passed === measured.length && invalid === 0 ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    const invalidNote = invalid ? ` ${YELLOW}(${invalid} invalid)${RESET}` : "";
    console.log(`  run ${i}/${times}  ${mark} ${passed}/${measured.length} cases${invalidNote}`);
  }

  const records = loadRecords(startLine);
  const tests = aggregate(records);
  const nodeids = Object.keys(tests).sort();

  console.log(`\n${"=".repeat(60)}\nRepeat summary (${times} runs)\n${"=".repeat(60)}`);
  if (nodeids.length === 0) {
    console.log("  (no records produced — check the pattern / -t filter)");
  }
  for (const id of nodeids) printTest(tests[id], times);

  // Flaky band → a targeted top-up, not a bigger suite. Raising n for EVERY case to firm up two
  // flaky ones multiplies the whole run's cost; the -t filter reruns exactly the cases whose
  // verdict needs the extra rows. Printed as a suggestion, never executed — model-backed lanes
  // are spent by a human decision (root AGENTS.md), and this tool keeps that rule.
  const flaky = nodeids.filter((id) => isFlaky(tests[id].pass.rate, tests[id].pass.total));
  if (flaky.length > 0) {
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const names = flaky.map((id) => esc(tests[id].label)).join("|");
    console.log(`\n  ${YELLOW}${flaky.length} case(s) in the flaky band (${pct(FLAKY_LOW)}–${pct(FLAKY_HIGH)})${RESET} — raise n for just these:`);
    console.log(`  ${DIM}EVAL_MAX_REPEATS=5 pnpm eval:repeat ${vitestArgs.join(" ")} -t "${names}" -n 5${RESET}`);
  }

  // A case with ZERO records is invisible: the summary is built from records, so it silently
  // shrinks and the remaining cases read as a clean sweep. printTest's `n < times` caveat cannot
  // catch it — that fires per case, and this case has no rows to print at all.
  //
  // This is not hypothetical. A dispatch case whose early stop failed ran past the 240s vitest
  // timeout; the kill left its `finally` unreached, so it wrote nothing, and a 6-case run reported
  // "5/5 cases" in green (measured 2026-08-25). Missing is not passing — say so.
  if (nCases !== null && nodeids.length < nCases) {
    console.log(
      `\n  ${RED}${nCases - nodeids.length} of ${nCases} case(s) produced NO records and are ABSENT` +
        ` from this summary — not passing, missing.${RESET}` +
        `\n  ${DIM}Usual cause: the test was killed (vitest timeout) before it could record.` +
        ` Re-run that case alone to see it fail properly.${RESET}`,
    );
  }

  if (label) {
    const git = gitInfo();
    mkdirSync(RESULTS_DIR, { recursive: true });
    const file = join(RESULTS_DIR, `repeat-${label}.json`);
    writeFileSync(file, JSON.stringify({ label, git_sha: git.sha, dirty: git.dirty, times, vitestArgs, tests }, null, 2));
    console.log(`\n${GREEN}Saved as '${label}'${RESET} -> ${file}`);
    console.log(`Compare with: pnpm eval:delta <baseline-label> ${label}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
