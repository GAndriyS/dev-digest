import type {
  BlastRadius,
  Finding,
  FindingRecord,
  ReviewRecord,
  RunSummary,
  Severity,
  Verdict,
} from '@devdigest/shared';
import {
  CHARACTER_LIMIT,
  MAX_BLAST_CALLERS_PER_SYMBOL,
  MAX_BLAST_ENDPOINTS,
  MAX_BLAST_SYMBOLS,
  MAX_TEXT_CHARS,
} from '../constants.js';
import type { AgentRunOutcome, BlastImpactSummary, FindingSummary, SeverityCounts } from '../schemas.js';

/**
 * Pure shaping helpers (plan decision 8's service layer): take resolved
 * values, never a transport object, so they are trivially unit-testable and
 * shared by every tool that renders findings.
 */

const SEVERITY_RANK: Record<Severity, number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 };
const VERDICT_RANK: Record<Verdict, number> = { request_changes: 0, comment: 1, approve: 2 };

export function truncateText(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

export function formatLines(startLine: number, endLine: number): string {
  return startLine === endLine ? String(startLine) : `${startLine}-${endLine}`;
}

/**
 * Every non-dismissed finding of every review of a PR (plan decision 2: a
 * latest-only view buries a finding a newer, empty review didn't reproduce).
 * No cross-agent dedup — findings keep their originating agent's name.
 */
export function aggregateFindings(
  reviews: Pick<ReviewRecord, 'agent_name' | 'findings'>[],
): { finding: FindingRecord; agent: string | null }[] {
  const out: { finding: FindingRecord; agent: string | null }[] = [];
  for (const review of reviews) {
    for (const finding of review.findings) {
      if (finding.dismissed_at) continue;
      out.push({ finding, agent: review.agent_name ?? null });
    }
  }
  return out;
}

/** Severity desc (CRITICAL first) → confidence desc → file asc. */
export function sortFindings<
  T extends { finding: Pick<Finding, 'severity' | 'confidence' | 'file'> },
>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const sevDiff = SEVERITY_RANK[a.finding.severity] - SEVERITY_RANK[b.finding.severity];
    if (sevDiff !== 0) return sevDiff;
    const confDiff = b.finding.confidence - a.finding.confidence;
    if (confDiff !== 0) return confDiff;
    return a.finding.file.localeCompare(b.finding.file);
  });
}

export function countSeverities(findings: Pick<Finding, 'severity'>[]): SeverityCounts {
  const counts: SeverityCounts = { critical: 0, warning: 0, suggestion: 0 };
  for (const f of findings) {
    if (f.severity === 'CRITICAL') counts.critical += 1;
    else if (f.severity === 'WARNING') counts.warning += 1;
    else counts.suggestion += 1;
  }
  return counts;
}

/** Worst-of across agents: request_changes > comment > approve. `null` when
 *  every verdict is null (e.g. every run failed before producing one). */
export function worstVerdict(verdicts: (Verdict | null)[]): Verdict | null {
  let best: Verdict | null = null;
  for (const v of verdicts) {
    if (!v) continue;
    if (best === null || VERDICT_RANK[v] < VERDICT_RANK[best]) best = v;
  }
  return best;
}

/** Lowest score across the agents that produced one — the pessimistic read
 *  that matches `worstVerdict` (higher score is better in the Review
 *  contract). `null` when nothing scored. */
export function worstScore(scores: (number | null | undefined)[]): number | null {
  const scored = scores.filter((s): s is number => s != null);
  return scored.length > 0 ? Math.min(...scored) : null;
}

/**
 * One outcome row per run THIS call started, joined to its review by `run_id`.
 * A failed run keeps its row (with `error`) rather than aborting the others —
 * one broken agent must not hide what the rest found.
 */
export function correlateRuns(
  runs: Pick<RunSummary, 'run_id' | 'agent_name' | 'status' | 'error'>[],
  reviews: Pick<ReviewRecord, 'run_id' | 'verdict' | 'score' | 'findings'>[],
): AgentRunOutcome[] {
  const reviewByRunId = new Map(reviews.map((r) => [r.run_id, r]));
  return runs.map((run) => {
    const review = reviewByRunId.get(run.run_id);
    return {
      agent: run.agent_name ?? '(unknown agent)',
      status: run.status ?? 'unknown',
      verdict: review?.verdict ?? null,
      score: review?.score ?? null,
      findings_count: review ? review.findings.filter((f) => !f.dismissed_at).length : 0,
      ...(run.error ? { error: truncateText(run.error, MAX_TEXT_CHARS) } : {}),
    };
  });
}

export function toFindingSummary(
  finding: Pick<
    Finding,
    'severity' | 'category' | 'title' | 'file' | 'start_line' | 'end_line' | 'confidence' | 'rationale' | 'suggestion'
  >,
  agent: string | null,
): FindingSummary {
  return {
    severity: finding.severity,
    category: finding.category,
    title: finding.title,
    file: finding.file,
    lines: formatLines(finding.start_line, finding.end_line),
    agent,
    confidence: finding.confidence,
    rationale: truncateText(finding.rationale, MAX_TEXT_CHARS),
    ...(finding.suggestion ? { suggestion: truncateText(finding.suggestion, MAX_TEXT_CHARS) } : {}),
  };
}

/**
 * Compact the server's blast map: full counts, then only the widest-reaching
 * symbols with their top callers. The UI tree is built for a human who
 * scrolls; a coding agent needs the shape of the impact and a few precise
 * `file:line` anchors it can open next.
 *
 * Counts are taken from the WHOLE map, never from the truncated slice — a
 * caller must not read "3 callers" when the symbol has forty.
 */
export function toBlastSummary(blast: BlastRadius): {
  changedSymbols: number;
  totalCallers: number;
  endpoints: string[];
  crons: string[];
  impacts: BlastImpactSummary[];
  truncated: boolean;
} {
  const totalCallers = blast.downstream.reduce((n, d) => n + d.callers.length, 0);
  const endpoints = [...new Set(blast.downstream.flatMap((d) => d.endpoints_affected))].sort();
  const crons = [...new Set(blast.downstream.flatMap((d) => d.crons_affected))].sort();

  const ranked = [...blast.downstream].sort((a, b) => b.callers.length - a.callers.length);
  const impacts: BlastImpactSummary[] = ranked.slice(0, MAX_BLAST_SYMBOLS).map((d) => ({
    symbol: d.symbol,
    caller_count: d.callers.length,
    top_callers: d.callers.slice(0, MAX_BLAST_CALLERS_PER_SYMBOL).map((c) => ({
      name: c.name,
      file: c.file,
      line: c.line,
    })),
    endpoints_affected: d.endpoints_affected,
    crons_affected: d.crons_affected,
  }));

  return {
    changedSymbols: blast.changed_symbols.length,
    totalCallers,
    endpoints: endpoints.slice(0, MAX_BLAST_ENDPOINTS),
    crons,
    impacts,
    truncated:
      ranked.length > MAX_BLAST_SYMBOLS ||
      endpoints.length > MAX_BLAST_ENDPOINTS ||
      ranked.some((d) => d.callers.length > MAX_BLAST_CALLERS_PER_SYMBOL),
  };
}

/**
 * Slice an already-paginated list down to `CHARACTER_LIMIT` JSON-serialized
 * chars, dropping from the tail. Pagination (`get_findings` limit/offset) is
 * the primary defence against an oversized response; this is the backstop
 * for one single page that is still too large (e.g. very long rationales).
 */
export function truncateToCharacterLimit<T>(
  items: T[],
  limit: number = CHARACTER_LIMIT,
): { items: T[]; truncated: boolean } {
  let size = 2; // "[]"
  const kept: T[] = [];
  for (const item of items) {
    const itemSize = JSON.stringify(item).length + 1; // +1 for the separating comma
    if (size + itemSize > limit && kept.length > 0) {
      return { items: kept, truncated: true };
    }
    size += itemSize;
    kept.push(item);
  }
  return { items: kept, truncated: false };
}
