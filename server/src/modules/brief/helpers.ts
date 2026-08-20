import { z } from 'zod';
import type { ChatMessage, Risk, ReviewFocusItem, PrWhyBrief } from '@devdigest/shared';
import { RiskSeverity, PrWhyBrief as PrWhyBriefSchema } from '@devdigest/shared';
import { assemblePrompt } from '../../platform/prompt.js';
import { clipHead } from '../_shared/prompt-text.js';
import { MAX_BRIEF_FACTS_CHARS, MAX_BRIEF_RISKS, MAX_BRIEF_REVIEW_FOCUS } from './constants.js';
import type { BriefFacts, BriefTelemetry, DiffFileFacts } from './types.js';

/**
 * PR Why + Risk Brief — pure helpers. No I/O, no container: the draft→wire
 * grounding is the part most worth testing with plain values (mirrors
 * `modules/onboarding/helpers.ts`).
 */

// ---------------------------------------------------------------------------
// BriefDraft — what the model is asked to return (AC-15).
//
// A separate, strict-compatible draft, NOT the wire contract: no `z.record`,
// no `.optional()` anywhere in this tree (OpenAI's strict `json_schema` mode
// requires every property present, `server/INSIGHTS.md:31-41`). `file_refs`
// and `review_focus[].path` are re-validated against the collected facts by
// `groundBrief` below — never trusted from the model as-is (AC-18/AC-19/AC-20).
// ---------------------------------------------------------------------------

const RiskDraft = z.object({
  kind: z.string(),
  title: z.string(),
  explanation: z.string(),
  severity: RiskSeverity,
  file_refs: z.array(z.string()),
});

const ReviewFocusDraft = z.object({
  path: z.string(),
  reason: z.string(),
  line: z.number().int().nullable(),
});

export const BriefDraft = z.object({
  what: z.string(),
  why: z.string(),
  risk_level: RiskSeverity,
  risks: z.array(RiskDraft),
  review_focus: z.array(ReviewFocusDraft),
});
export type BriefDraft = z.infer<typeof BriefDraft>;

// ---------------------------------------------------------------------------
// Diff facts (AC-7) — paths, counters and `@@` hunk headers ONLY. Never a
// hunk body / patch content line reaches this function's output.
// ---------------------------------------------------------------------------

const HUNK_HEADER_RE = /^@@ .*@@.*$/gm;

/** One entry per PR file, in the given order — no filtering, no truncation here. */
export function diffFactsFromPrFiles(
  files: { path: string; additions: number; deletions: number; patch: string | null }[],
): DiffFileFacts[] {
  return files.map((f) => ({
    path: f.path,
    additions: f.additions,
    deletions: f.deletions,
    hunkHeaders: f.patch ? (f.patch.match(HUNK_HEADER_RE) ?? []) : [],
  }));
}

// ---------------------------------------------------------------------------
// Project Context relevance (AC-11) — Open question 7's default predicate.
// ---------------------------------------------------------------------------

/** The first path segment, or `null` for a repo-root file (`config.ts`, not `src/config.ts`). */
function leadingSegment(path: string): string | null {
  const idx = path.indexOf('/');
  return idx === -1 ? null : path.slice(0, idx);
}

/**
 * A Project Context document is relevant when its path and some changed
 * file's path share at least one leading directory segment; the repo root
 * does not count as a shared prefix on its own — a root-level DOC is only
 * relevant when a CHANGED FILE is also at the root (Open question 7). Order
 * is preserved from `files` (already alphabetical from `listContext`).
 */
export function relevantContextDocs<T extends { path: string }>(
  files: T[],
  changedPaths: string[],
): T[] {
  const changedSegments = new Set<string>();
  let changedHasRootFile = false;
  for (const p of changedPaths) {
    const seg = leadingSegment(p);
    if (seg === null) changedHasRootFile = true;
    else changedSegments.add(seg);
  }

  return files.filter((f) => {
    const seg = leadingSegment(f.path);
    return seg === null ? changedHasRootFile : changedSegments.has(seg);
  });
}

// ---------------------------------------------------------------------------
// Prompt assembly (AC-6, AC-7, AC-43).
// ---------------------------------------------------------------------------

/**
 * One system + one user message via `assemblePrompt`. Every fact source is
 * text — intent, blast, diff stats and the linked issue are combined into
 * ONE block and passed through the `diff` slot (same "non-diff facts through
 * the diff slot, framed by `task`" pattern `blast/service.ts:117-127` uses
 * for its summary prompt); Project Context docs use the `specs` slot, one
 * entry per document, matching how `ContextService.resolveForRun` already
 * formats them for `reviewer-core`. `assemblePrompt` wraps both in
 * `<untrusted>` and appends the shared injection guard — AC-43's "only ever
 * inside the existing wrapper" is enforced by construction, not convention.
 */
export function buildBriefMessages(facts: BriefFacts, systemPrompt: string): ChatMessage[] {
  const intentBlock = facts.intent
    ? [
        `Intent: ${facts.intent.intent}`,
        `In scope: ${facts.intent.in_scope.join('; ') || '(none)'}`,
        `Out of scope: ${facts.intent.out_of_scope.join('; ') || '(none)'}`,
        `Risk areas: ${facts.intent.risk_areas.join('; ') || '(none)'}`,
      ].join('\n')
    : '(intent not yet derived for this PR)';

  const affectedEndpoints = [
    ...new Set(facts.blast.downstream.flatMap((d) => d.endpoints_affected)),
  ];
  const blastBlock = [
    `Status: ${facts.blast.status}${facts.blast.reason ? ` (${facts.blast.reason})` : ''}`,
    facts.blast.summary,
    `Endpoints affected: ${affectedEndpoints.join(', ') || '(none)'}`,
  ].join('\n');

  const diffBlock =
    facts.diffFiles
      .map(
        (f) =>
          `${f.path} (+${f.additions}/-${f.deletions})\n${f.hunkHeaders.join('\n') || '(no hunk headers)'}`,
      )
      .join('\n\n') || '(no changed files recorded for this PR)';

  const issueBlock = facts.linkedIssue
    ? `#${facts.linkedIssue.number}: ${facts.linkedIssue.title}\n${facts.linkedIssue.body ?? ''}`
    : '(no linked issue)';

  const factsText = clipHead(
    [
      '## PR intent',
      intentBlock,
      '## Blast radius',
      blastBlock,
      '## Changed files (paths, line counts, hunk headers only — never hunk bodies)',
      diffBlock,
      '## Linked issue',
      issueBlock,
    ].join('\n\n'),
    MAX_BRIEF_FACTS_CHARS,
  );

  const { messages } = assemblePrompt({
    system: systemPrompt,
    specs: facts.contextDocs.map((d) => `### ${d.path}\n\n${d.content}`),
    diff: factsText,
    task:
      'Write a why/risk brief for this PR from the evidence below (PR intent, ' +
      'blast radius, changed-file stats, linked issue, and Project Context ' +
      'documents where present).',
  });
  return messages;
}

// ---------------------------------------------------------------------------
// Grounding (AC-18, AC-19, AC-20, AC-21, AC-22, Open question 1).
// ---------------------------------------------------------------------------

export interface GroundedBrief {
  risks: Risk[];
  reviewFocus: ReviewFocusItem[];
  droppedRisks: number;
  droppedReviewFocus: number;
}

/** Every path that appeared anywhere in the facts handed to the model this call (AC-18). */
function knownPathsOf(facts: BriefFacts): Set<string> {
  const known = new Set<string>();
  for (const f of facts.diffFiles) known.add(f.path);
  for (const s of facts.blast.changed_symbols) known.add(s.file);
  for (const d of facts.blast.downstream) for (const c of d.callers) known.add(c.file);
  for (const d of facts.contextDocs) known.add(d.path);
  return known;
}

/** `METHOD /path` tokens, matching the exact shape blast's `endpoints_affected` uses. */
const ENDPOINT_MENTION_RE = /\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[^\s,;)]+)/gi;

/** `true` when `text` names an endpoint (`METHOD /path` shaped) that isn't in `known` (AC-19). */
function mentionsUngroundedEndpoint(text: string, known: Set<string>): boolean {
  for (const m of text.matchAll(ENDPOINT_MENTION_RE)) {
    const mentioned = `${m[1]!.toUpperCase()} ${m[2]}`;
    if (!known.has(mentioned)) return true;
  }
  return false;
}

/**
 * Draft → wire `risks`/`review_focus`, grounded against this call's OWN
 * facts and capped at `MAX_BRIEF_RISKS`/`MAX_BRIEF_REVIEW_FOCUS` (Open
 * question 1). A `risks[]` item that names an endpoint outside
 * `blast.endpoints_affected` is dropped WHOLE (AC-19) — free text cannot be
 * partially redacted the way a `file_refs` array can be filtered.
 * `review_focus[]` items are restricted to THIS PR's changed files (AC-20,
 * stricter than `risks[].file_refs`'s wider known-paths set) since `path` is
 * also the client's navigation target (AC-21: an empty result is valid).
 */
export function groundBrief(draft: BriefDraft, facts: BriefFacts): GroundedBrief {
  const knownPaths = knownPathsOf(facts);
  const knownEndpoints = new Set(facts.blast.downstream.flatMap((d) => d.endpoints_affected));
  const prFilePaths = new Set(facts.diffFiles.map((f) => f.path));

  let droppedRisks = 0;
  const risks: Risk[] = [];
  for (const r of draft.risks) {
    if (mentionsUngroundedEndpoint(`${r.title} ${r.explanation}`, knownEndpoints)) {
      droppedRisks++;
      continue;
    }
    risks.push({ ...r, file_refs: r.file_refs.filter((p) => knownPaths.has(p)) });
  }

  let droppedReviewFocus = 0;
  const reviewFocus: ReviewFocusItem[] = [];
  for (const item of draft.review_focus) {
    if (!prFilePaths.has(item.path)) {
      droppedReviewFocus++;
      continue;
    }
    reviewFocus.push(item);
  }

  return {
    risks: risks.slice(0, MAX_BRIEF_RISKS),
    reviewFocus: reviewFocus.slice(0, MAX_BRIEF_REVIEW_FOCUS),
    droppedRisks: droppedRisks + Math.max(0, risks.length - MAX_BRIEF_RISKS),
    droppedReviewFocus: droppedReviewFocus + Math.max(0, reviewFocus.length - MAX_BRIEF_REVIEW_FOCUS),
  };
}

// ---------------------------------------------------------------------------
// Server log line (AC-45, amendment A4) and stored-row parsing.
// ---------------------------------------------------------------------------

/**
 * One structured-log fields object per generation. `inputs` carries the FULL
 * per-source provenance list (amendment A4) — never summarized to a count —
 * so "the model found nothing" and "the source was unavailable" stay
 * distinguishable in a postmortem that only has logs.
 */
export function briefLogFields(t: BriefTelemetry): Record<string, unknown> {
  return {
    provider: t.provider,
    model: t.model,
    calls: t.calls,
    attempts: t.attempts,
    tokensIn: t.tokensIn,
    tokensOut: t.tokensOut,
    costUsd: t.costUsd,
    prId: t.prId,
    durationMs: t.durationMs,
    droppedRisks: t.droppedRisks,
    droppedReviewFocus: t.droppedReviewFocus,
    inputs: t.inputs,
  };
}

/**
 * `safeParse` the `pr_brief.json` jsonb column — never `JSON.parse` a
 * trusted-shaped assumption, never throw on drift (`parseStoredTour`
 * precedent, `onboarding/helpers.ts`). A row that fails to parse (the
 * contract moved on since it was written) is treated exactly like "no brief
 * generated yet", not a 500. The persisted `stale` value is never trusted —
 * `service.ts` recomputes it on every read against `pr_brief.head_sha`.
 */
export function parseStoredBrief(json: unknown): PrWhyBrief | null {
  const parsed = PrWhyBriefSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}
