/**
 * LLM Message Pattern judge, on the subscription. Binary PASS/FAIL per practice, PASS only with
 * a verbatim evidence quote. The judge defaults to a stronger family than the task to soften
 * single-model self-preference; the structural mitigations (blind + binary + verbatim) do the
 * rest, since on a shared subscription the families overlap.
 */

import { EVAL_JUDGE_MODEL } from "../config.js";
import { runContent } from "../runtime/dispatch.js";

const JUDGE_RUBRIC =
  "You are a strict, blind evaluator. Given an OUTPUT and a list of PRACTICES, judge each " +
  "practice independently.\n" +
  "Rules: (1) exactly PASS or FAIL per practice, no scales. (2) PASS only when a direct " +
  "verbatim quote from the OUTPUT is evidence the practice was met — a keyword is not " +
  "evidence. (3) Reply with ONLY minified JSON:\n" +
  '{"results":[{"practice":"<text>","passed":true,"evidence":"<verbatim quote>"}]}';

export interface Verdict {
  results: { practice: string; passed: boolean; evidence: string }[];
  passed: number;
  total: number;
  score: number;
}

function parseVerdict(text: string): Verdict["results"] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) throw new Error(`judge returned no JSON: ${text.slice(0, 200)}`);
  const obj = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(obj.results)) throw new Error("judge JSON missing results[]");
  return obj.results;
}

const normalize = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Re-key the judge's verdicts onto the CANONICAL practice strings from the case file.
 *
 * The judge echoes each practice back, and it does not always echo it byte-for-byte — a dropped
 * pair of backticks is enough. Everything downstream keys on that string: `aggregate()` buckets
 * per-practice pass rates by it, and `eval:delta` matches the two series by it. So a single
 * paraphrase splits one practice into two rows in a repeat summary (observed 2026-08-25: the same
 * practice reported as `1/1` and `4/4` in one series) and renders `— → X%` in the delta instead of
 * the real movement — a silently lost comparison in exactly the tool built for comparing.
 *
 * The judge is prompted with a numbered list and replies in order, so the index is the reliable
 * join. Normalized text matching is the fallback for a reordered or short reply; anything that
 * still matches nothing keeps the judge's own wording rather than being dropped.
 */
function rekey(results: Verdict["results"], practices: string[]): Verdict["results"] {
  if (results.length === practices.length) return results.map((r, i) => ({ ...r, practice: practices[i] }));
  const byNorm = new Map(practices.map((p) => [normalize(p), p]));
  return results.map((r) => {
    const canonical = byNorm.get(normalize(r.practice));
    return canonical ? { ...r, practice: canonical } : r;
  });
}

/** Judge an output against a list of practices. Model defaults to the stronger judge family. */
export async function llmJudge(output: string, practices: string[], model = EVAL_JUDGE_MODEL): Promise<Verdict> {
  const listed = practices.map((p, i) => `${i + 1}. ${p}`).join("\n");
  const prompt = `${JUDGE_RUBRIC}\n\n## PRACTICES\n${listed}\n\n## OUTPUT\n${output}\n\nReturn the JSON now.`;
  const res = await runContent(prompt, { allowedTools: [], maxTurns: 1, model });
  const results = rekey(parseVerdict(res.text), practices);
  if (results.length !== practices.length) {
    console.error(`  judge returned ${results.length} verdicts for ${practices.length} practices — scoring the missing ones as unmet`);
  }
  // Denominator is what the CASE asked for, not what the judge chose to answer. Scoring over
  // `results.length` let a judge that silently dropped a practice inflate the score — worst at
  // threshold 1.0, where a 5-of-5 reply to a 6-practice case reads as a perfect pass.
  const total = practices.length || 1;
  const passed = results.filter((r) => r.passed).length;
  return { results, passed, total, score: passed / total };
}
