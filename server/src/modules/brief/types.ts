/**
 * PR Why + Risk Brief (L05/SPEC-04) — internal types. Published surface
 * alongside `constants.ts` (other modules may import `types.ts`, never
 * `service`/`repository`/`helpers`/`facts`).
 */
import type { BriefInput, Intent, BlastRadius } from '@devdigest/shared';

/**
 * One PR-changed-file's diff facts — the ONLY diff-derived data that reaches
 * the model (AC-7). `hunkHeaders` are `@@ -a,b +c,d @@` lines only, NEVER a
 * hunk body / patch content line.
 */
export interface DiffFileFacts {
  path: string;
  additions: number;
  deletions: number;
  hunkHeaders: string[];
}

/** The linked issue's text, once resolved (AC-10). */
export interface LinkedIssueFacts {
  number: number;
  title: string;
  body: string | null;
}

/** One Project Context document that made it into the prompt (AC-11/AC-12). */
export interface ContextDocFacts {
  path: string;
  content: string;
}

/**
 * Everything code gathers about a PR BEFORE the one model call — facts.ts's
 * output. `inputs` is the full provenance list (AC-6, AC-8..AC-13) — every
 * source that was tried, not just the ones that succeeded.
 */
export interface BriefFacts {
  /** `null` when intent has not been derived yet for this PR (AC-8) — generation still proceeds. */
  intent: Intent | null;
  /** Always present — `status` says how much of the index backed it (AC-9). */
  blast: BlastRadius;
  diffFiles: DiffFileFacts[];
  /** `null` when there is no linked issue, or GitHub did not respond (AC-10). */
  linkedIssue: LinkedIssueFacts | null;
  contextDocs: ContextDocFacts[];
  inputs: BriefInput[];
}

/** What one `generate()` call reports for the server log line (AC-45, amendment A4). */
export interface BriefTelemetry {
  provider: string;
  model: string;
  /** Provider round-trips — 1 for an attempted generation. */
  calls: number;
  /** `completeStructured`'s attempt count (retries collapse into ONE call). */
  attempts: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  prId: string;
  durationMs: number;
  /**
   * Amendment A4 — the FULL provenance list, one entry per source with its
   * own status, not a summary count: "the model found nothing" and "the
   * source was unavailable" must stay distinguishable in a postmortem that
   * only has logs.
   */
  inputs: BriefInput[];
  /** Risks the model proposed that were dropped by grounding/truncation. */
  droppedRisks: number;
  /** Review-focus items the model proposed that were dropped by grounding/truncation. */
  droppedReviewFocus: number;
}
