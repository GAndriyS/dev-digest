import { z } from 'zod';

/**
 * PR Brief building blocks: Intent, Blast radius, Risks, PR History,
 * Smart Diff. Composed into PrBrief.
 */

// ---- Intent ----
/**
 * Provenance for one input the intent classifier tried to use. `ref` names the
 * thing (an issue number, a repo-relative path, an external URL); `status` is
 * `'unavailable'` for anything not actually read — an external http(s) link
 * (never fetched, L03 open question 1), a linked issue the API call failed
 * for, or a referenced file the guarded clone reader could not read. The UI
 * renders `unavailable` entries so a low-confidence intent is explainable
 * rather than just a number.
 */
export const IntentSource = z.object({
  type: z.enum(['description', 'linked_issue', 'repo_file']),
  ref: z.string().optional(),
  status: z.enum(['used', 'unavailable']),
});
export type IntentSource = z.infer<typeof IntentSource>;

export const Intent = z.object({
  intent: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
  /** Short noun phrases naming where a reviewer should look closely — never a directive. */
  risk_areas: z.array(z.string()),
  /** Calibrated 0-1: lower when the description is thin or a source is unavailable. */
  confidence: z.number().min(0).max(1),
  sources: z.array(IntentSource),
});
export type Intent = z.infer<typeof Intent>;

// ---- Blast radius ----
export const ChangedSymbol = z.object({
  name: z.string(),
  file: z.string(),
  kind: z.string(),
});
export type ChangedSymbol = z.infer<typeof ChangedSymbol>;

export const BlastCaller = z.object({
  name: z.string(),
  file: z.string(),
  line: z.number().int(),
  /** `file_rank.rank` (pagerank) of the calling file — 0 on the degraded path. */
  rank: z.number(),
});
export type BlastCaller = z.infer<typeof BlastCaller>;

export const DownstreamImpact = z.object({
  symbol: z.string(),
  callers: z.array(BlastCaller),
  endpoints_affected: z.array(z.string()),
  crons_affected: z.array(z.string()),
});
export type DownstreamImpact = z.infer<typeof DownstreamImpact>;

/**
 * How much of the index backed this map. Missing data is never a silent `[]`:
 * `partial` still renders (the index is usable but incomplete), `degraded`
 * means the persistent path was unavailable and `reason` says why — the caller
 * shows an explanation instead of "nothing depends on this".
 */
export const BlastStatus = z.enum(['full', 'partial', 'degraded']);
export type BlastStatus = z.infer<typeof BlastStatus>;

export const BlastRadius = z.object({
  changed_symbols: z.array(ChangedSymbol),
  downstream: z.array(DownstreamImpact),
  /** Deterministic counts sentence built from the index — never model-written. */
  summary: z.string(),
  status: BlastStatus,
  /** A `DegradedReason` when `status` is `degraded`; absent otherwise. */
  reason: z.string().optional(),
  /**
   * The commit the INDEX was built at — which is what every `file`/`line` here
   * refers to, and usually not the PR's head. Resolve line references against
   * this, never against `head_sha`, or a file that moved between the two sends
   * the reader to an unrelated line.
   */
  indexed_sha: z.string().nullable(),
});
export type BlastRadius = z.infer<typeof BlastRadius>;

// ---- Risks ----
export const RiskSeverity = z.enum(['high', 'medium', 'low']);
export type RiskSeverity = z.infer<typeof RiskSeverity>;

export const Risk = z.object({
  kind: z.string(),
  title: z.string(),
  explanation: z.string(),
  severity: RiskSeverity,
  file_refs: z.array(z.string()),
});
export type Risk = z.infer<typeof Risk>;

export const Risks = z.object({
  risks: z.array(Risk),
});
export type Risks = z.infer<typeof Risks>;

// ---- PR History ----
export const PrHistoryItem = z.object({
  pr_number: z.number().int(),
  title: z.string(),
  merged_at: z.string(),
  author: z.string(),
  files_overlap: z.array(z.string()),
  notes: z.string(),
});
export type PrHistoryItem = z.infer<typeof PrHistoryItem>;

export const PrHistory = z.object({
  history: z.array(PrHistoryItem),
});
export type PrHistory = z.infer<typeof PrHistory>;

// ---- Smart Diff ----
export const SmartDiffRole = z.enum(['core', 'wiring', 'boilerplate']);
export type SmartDiffRole = z.infer<typeof SmartDiffRole>;

export const SmartDiffFile = z.object({
  path: z.string(),
  pseudocode_summary: z.string().nullish(),
  additions: z.number().int(),
  deletions: z.number().int(),
  finding_lines: z.array(z.number().int()),
});
export type SmartDiffFile = z.infer<typeof SmartDiffFile>;

export const SmartDiffGroup = z.object({
  role: SmartDiffRole,
  files: z.array(SmartDiffFile),
});
export type SmartDiffGroup = z.infer<typeof SmartDiffGroup>;

export const ProposedSplit = z.object({
  name: z.string(),
  files: z.array(z.string()),
});
export type ProposedSplit = z.infer<typeof ProposedSplit>;

export const SmartDiff = z.object({
  groups: z.array(SmartDiffGroup),
  split_suggestion: z.object({
    too_big: z.boolean(),
    total_lines: z.number().int(),
    proposed_splits: z.array(ProposedSplit),
  }),
});
export type SmartDiff = z.infer<typeof SmartDiff>;

// ---- Composed PR Brief (pr_brief.json) ----
export const PrBrief = z.object({
  intent: Intent,
  blast: BlastRadius,
  risks: Risks,
  history: PrHistory,
});
export type PrBrief = z.infer<typeof PrBrief>;

// ---- PR Why/Risk Brief (pr_brief.head_sha / generated_at / model) ----
/**
 * One item the model was told to look at while reviewing. `path` is the ONLY
 * navigation target — it must be a path from this PR's changed files, and the
 * client opens exactly that `FileCard` via `?file=`. `line` is text-only
 * context (e.g. "around line 42" in the reason), never a jump target and
 * never an anchor: blast-radius line numbers resolve against `indexed_sha`,
 * not `head_sha` (see BlastRadius.indexed_sha), so a `file:line` pair here
 * could point at a line that has since moved. `null` means the model did not
 * name a line, not "line 0".
 */
export const ReviewFocusItem = z.object({
  path: z.string(),
  reason: z.string(),
  line: z.number().int().nullable(),
});
export type ReviewFocusItem = z.infer<typeof ReviewFocusItem>;

/**
 * Provenance for one input the brief generator tried to use. `ref` and the
 * legal `status` values differ by `type`:
 *  - `intent`       — `ref: null`; `status` `used` | `unavailable`.
 *  - `blast`        — `ref` is `indexed_sha` or `null`; `status` `used` |
 *                      `partial` | `degraded` — the only variant where
 *                      `partial`/`degraded` are legal, and the reason a brief
 *                      may not claim "nothing depends on this".
 *  - `diff`         — `ref: null`; `unavailable` when `pr_files` is empty
 *                      (a PR nobody has opened yet).
 *  - `linked_issue`  — `ref` is `#<number>` as a string; `unavailable` when
 *                      there is no linked issue or GitHub did not respond.
 *  - `context_doc`  — one entry PER DOCUMENT, `ref` is the repo-relative
 *                      POSIX path; `used` for docs that made it into the
 *                      prompt, `unavailable` for ones dropped by the budget
 *                      or unreadable.
 */
export const BriefInput = z.object({
  type: z.enum(['intent', 'blast', 'diff', 'linked_issue', 'context_doc']),
  ref: z.string().nullable(),
  status: z.enum(['used', 'unavailable', 'partial', 'degraded']),
});
export type BriefInput = z.infer<typeof BriefInput>;

/**
 * "Why this PR, what to watch" brief — a separate, additive artifact from
 * `PrBrief` above (not a replacement; both are stored under `pr_brief`).
 * `what`/`why` and every `ReviewFocusItem.reason` are untrusted model text,
 * rendered escaped. There is deliberately no `score` field here: the review
 * score's single source of truth is `reviews.score`, read separately.
 */
export const PrWhyBrief = z.object({
  /** What the PR does — never a paraphrase of the PR title. */
  what: z.string(),
  /** Why the change was made. */
  why: z.string(),
  /** Same severity scale as `Risk.severity` — intentionally not a new enum. */
  risk_level: RiskSeverity,
  /** At most 5 after server-side truncation; may be empty. */
  risks: z.array(Risk),
  /** At most 5 after server-side truncation; an empty array is valid. */
  review_focus: z.array(ReviewFocusItem),
  inputs: z.array(BriefInput),
  /** The commit this brief was generated from. */
  head_sha: z.string(),
  /** ISO timestamp. */
  generated_at: z.string(),
  model: z.string().nullable(),
  /**
   * Computed by the server on every read by comparing this brief's
   * `head_sha` against the PR's current `head_sha` — never computed by the
   * client, which only displays it.
   */
  stale: z.boolean(),
});
export type PrWhyBrief = z.infer<typeof PrWhyBrief>;
