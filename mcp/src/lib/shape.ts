import type { Finding, FindingRecord, ReviewRecord, Severity, Verdict } from '@devdigest/shared';
import { CHARACTER_LIMIT } from '../constants.js';
import type { FindingSummary, SeverityCounts } from '../schemas.js';

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
    rationale: truncateText(finding.rationale, 500),
    ...(finding.suggestion ? { suggestion: truncateText(finding.suggestion, 500) } : {}),
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
