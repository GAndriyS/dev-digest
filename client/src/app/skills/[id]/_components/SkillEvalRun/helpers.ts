import type { EvalCase, EvalRun } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { NO_PROVIDER_KEY } from "./constants";

/**
 * `POST /skills/:id/eval-run` returns one EvalRun per case in list order. Match
 * on the trace name first (order is the server's, not necessarily ours) and
 * fall back to the position when a run carries no identifying trace.
 *
 * Colocated with SkillEvalRun, not EvalsTab: run-state ownership (this merge
 * included — see the comment on `runAll` in SkillEvalRun.tsx) moved to this
 * seam in L05 step 5, and this helper's only remaining caller moved with it.
 */
export function indexRunsByCase(cases: EvalCase[], runs: EvalRun[]): Record<string, EvalRun> {
  const byId: Record<string, EvalRun> = {};
  const unmatched: EvalRun[] = [];
  for (const run of runs) {
    const traceName = run.per_trace[0]?.name;
    const hit = traceName ? cases.find((c) => c.name === traceName) : undefined;
    if (hit) byId[hit.id] = run;
    else unmatched.push(run);
  }
  let cursor = 0;
  for (const c of cases) {
    if (byId[c.id]) continue;
    const next = unmatched[cursor];
    if (!next) break;
    byId[c.id] = next;
    cursor++;
  }
  return byId;
}

/** True when a failed eval run means "no LLM provider key is configured". */
export function isNoProviderKey(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && error.code === NO_PROVIDER_KEY;
}
