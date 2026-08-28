import { z } from 'zod';
import { Verdict, Finding } from './findings.js';
import { EvalRun, EvalOwnerKind, Conformance, Provider, CiFailOn } from './knowledge.js';

/**
 * A4 — Eval / CI / Compose / Conformance API contracts (L06).
 *
 * These EXTEND the barrel; they do not modify existing contract files. The base
 * `EvalRun`, `EvalCase`, `EvalOwnerKind`, `Conformance` live in `knowledge.ts`;
 * here we add the *API-facing* request/response shapes (records persisted in
 * `eval_runs`, `composed_reviews`, `ci_installations`, `ci_runs`,
 * `conformance_checks`) plus the eval-dashboard aggregate.
 */

// ===========================================================================
// Eval — case input + persisted run record + dashboard
// ===========================================================================

/** Create/update payload for an eval case (id + owner resolved by the route). */
export const EvalCaseInput = z.object({
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string().min(1),
  input_diff: z.string().default(''),
  input_files: z.unknown().nullish(),
  input_meta: z.unknown().nullish(),
  expected_output: z.unknown(),
  notes: z.string().nullish(),
  // Provenance pointer, not a relation — see EvalCase in knowledge.ts.
  // `.nullish()`: skill-owned case payloads (unchanged by this plan) never
  // set it. `null`/absent = created by hand.
  source_finding_id: z.string().nullish(),
});
export type EvalCaseInput = z.infer<typeof EvalCaseInput>;

/**
 * Shared shape for a failed run/case: the provider/timeout/validation reason,
 * never the raw error text a log would carry. Reused by `EvalRunRecord` and
 * `EvalCaseResult` — one persisted run and one in-batch case result read the
 * same failure.
 */
const EvalRunError = z.object({ code: z.string(), message: z.string() });

/** A persisted eval run row (one execution of a case), returned by the API. */
export const EvalRunRecord = z.object({
  id: z.string(),
  case_id: z.string(),
  case_name: z.string().nullish(),
  // Groups every run started by the same `POST /agents/:id/eval-runs` call
  // (AC-22). `null` on rows written before batches existed.
  batch_id: z.string().nullable(),
  // `agents.version` at the moment this run started (AC-22) — reproducibility,
  // independent of the agent's current config. `null` on pre-batch rows.
  agent_version: z.number().int().nullable(),
  ran_at: z.string(),
  actual_output: z.unknown(),
  // Non-null only when this run failed (AC-25); `pass`/the three metrics stay
  // `null` on the same row, and `actual_output` carries no `findings` then.
  error: EvalRunError.nullable(),
  pass: z.boolean().nullable(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
});
export type EvalRunRecord = z.infer<typeof EvalRunRecord>;

/** Result of running a single case: the metrics (EvalRun) + the persisted row id. */
export const EvalRunResult = z.object({
  run_id: z.string(),
  case_id: z.string(),
  result: EvalRun,
});
export type EvalRunResult = z.infer<typeof EvalRunResult>;

/**
 * One case's outcome inside an agent-set batch run (AC-12, AC-25) — the
 * per-case row of `AgentEvalBatch.cases`. `pass: null` means the case errored
 * (AC-25): `citation_accuracy`, `grounded_count` and `error` are the fields
 * that go empty/null together on a clean success, `error` populated only on
 * failure.
 */
export const EvalCaseResult = z.object({
  case_id: z.string(),
  case_name: z.string(),
  run_id: z.string(),
  pass: z.boolean().nullable(),
  recall: z.number(),
  precision: z.number(),
  citation_accuracy: z.number().nullable(),
  raw_count: z.number().int(),
  grounded_count: z.number().int().nullable(),
  error: EvalRunError.nullable(),
});
export type EvalCaseResult = z.infer<typeof EvalCaseResult>;

/**
 * One agent-set batch run, aggregated across its cases (AC-12, AC-22, AC-27,
 * AC-30). `cases_errored` rows are excluded from `recall`/`precision`/
 * `citation_accuracy` and from `traces_passed`/`traces_total` — see the
 * `pass: null` rule on `EvalRunRecord`/`EvalCaseResult`.
 */
export const EvalBatchRecord = z.object({
  batch_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
  agent_version: z.number().int(),
  ran_at: z.string(),
  recall: z.number(),
  precision: z.number(),
  citation_accuracy: z.number().nullable(),
  traces_passed: z.number().int(),
  traces_total: z.number().int(),
  cases_errored: z.number().int(),
  duration_ms: z.number().int(),
  cost_usd: z.number().nullable(),
});
export type EvalBatchRecord = z.infer<typeof EvalBatchRecord>;

/** Response of `POST /agents/:id/eval-runs` — the batch plus every case's result. */
export const AgentEvalBatch = EvalBatchRecord.extend({
  cases: z.array(EvalCaseResult),
});
export type AgentEvalBatch = z.infer<typeof AgentEvalBatch>;

/**
 * Regression banner (AC-31) — a structure, not a rendered sentence: the copy
 * lives in `messages/en/eval.json` (NFR i18n), the server only supplies the
 * numbers that fill it in.
 */
export const EvalAlert = z.object({
  metric: z.enum(['recall', 'precision']),
  drop_pp: z.number(),
  others: z.object({
    recall: z.number(),
    precision: z.number(),
    // Nullable, unlike `recall`/`precision` above: `citation_accuracy` is
    // itself nullable on `EvalBatchRecord` ("every case in the batch
    // errored" has no citation rate to report) — the server never coerces
    // that into a fabricated `0` here (fix pass, item 2b).
    citation_accuracy: z.number().nullable(),
  }),
});
export type EvalAlert = z.infer<typeof EvalAlert>;

/** One point on the dashboard trend (per run, chronological). */
export const EvalTrendPoint = z.object({
  ran_at: z.string(),
  recall: z.number(),
  precision: z.number(),
  // Nullable — mirrors `EvalBatchRecord.citation_accuracy` (null when every
  // case in that batch errored); the server no longer coerces null→0 here
  // (fix pass, item 2c), and the chart consumer treats a null point as a gap.
  citation_accuracy: z.number().nullable(),
  pass_rate: z.number(),
  cost_usd: z.number().nullable(),
});
export type EvalTrendPoint = z.infer<typeof EvalTrendPoint>;

/** Aggregate dashboard for an owner (agent/skill) or the whole workspace. */
export const EvalDashboard = z.object({
  owner_kind: EvalOwnerKind.nullable(),
  owner_id: z.string().nullable(),
  cases_total: z.number().int(),
  current: z.object({
    recall: z.number(),
    precision: z.number(),
    citation_accuracy: z.number(),
    traces_passed: z.number().int(),
    traces_total: z.number().int(),
    cost_usd: z.number().nullable(),
  }),
  // Nullable — `null` when there is no previous batch to compare against
  // (the very first run); the server never fabricates a flat 0.0pt delta for
  // that case (fix pass, item 5).
  delta: z
    .object({
      recall: z.number(),
      precision: z.number(),
      citation_accuracy: z.number(),
    })
    .nullable(),
  trend: z.array(EvalTrendPoint),
  // Per-case rows (AC-70/AC-71): every run row of the batches in
  // `recent_batches` below PLUS the newest single-case run per case that
  // never joined a batch (`batch_id: null` — a case run once from its own
  // editor, `POST /agents/:id/eval-cases/:caseId/run`). Can be non-empty even
  // when `recent_batches`/`trend`/`delta`/`alert` are all empty/`null` — a
  // case run this way is visible here without ever entering a batch
  // aggregate, trend point or regression comparison. Consumers reduce this
  // to "latest run per case" by `ran_at`, so order and any overlap with
  // `recent_batches`' own run rows never matter.
  recent_runs: z.array(EvalRunRecord),
  // Batch-level rows (one per agent-set run) for the "recent runs" table on the
  // agent's dashboard page (AC-30); `recent_runs` above stays per-case.
  recent_batches: z.array(EvalBatchRecord),
  alert: EvalAlert.nullable(),
});
export type EvalDashboard = z.infer<typeof EvalDashboard>;

/** One agent row in the Eval Dashboard overview (AC-26, AC-27). */
export const EvalAgentSummary = z.object({
  agent_id: z.string(),
  name: z.string(),
  model: z.string(),
  cases_total: z.number().int(),
  last_batch: EvalBatchRecord.nullable(),
  // Per-agent trend series for the row's sparkline (AC-40, AC-41). Reuses
  // `EvalTrendPoint` rather than a narrower shape so this and the agent page
  // share one exclusion rule: CHRONOLOGICAL, oldest first (the opposite of
  // every table in this feature), batches with `traces_total = 0` excluded,
  // capped at `BATCH_TABLE_LIMIT` (20) points — same rule, same constant as
  // the agent page's own trend. `last_batch === null` is the ONLY "never run"
  // discriminant; an agent can have a non-null `last_batch` and an EMPTY
  // `trend` when every batch it ran measured nothing. The sparkline itself
  // only draws `recall` (AC-40) — the rest of the point's fields ride along
  // because the shape is shared, not because the row renders them.
  trend: z.array(EvalTrendPoint),
});
export type EvalAgentSummary = z.infer<typeof EvalAgentSummary>;

/** Response of `GET /eval/overview` — every agent with a non-empty set, plus recent batches. */
export const EvalDashboardOverview = z.object({
  agents: z.array(EvalAgentSummary),
  recent_batches: z.array(EvalBatchRecord),
});
export type EvalDashboardOverview = z.infer<typeof EvalDashboardOverview>;

// ===========================================================================
// Compose Review
// ===========================================================================

export const ComposeReviewInput = z.object({
  /** Finding ids to fold into the draft (optional — body may be hand-written). */
  finding_ids: z.array(z.string()).default([]),
  /** Editable markdown body. If omitted, the server composes one from findings. */
  body: z.string().nullish(),
  verdict: Verdict.default('comment'),
  /** When true, attach selected findings as inline comments (path+line+body). */
  inline_comments: z.boolean().default(false),
});
export type ComposeReviewInput = z.infer<typeof ComposeReviewInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type ComposeReviewInputBody = z.input<typeof ComposeReviewInput>;

/** A persisted composed review (mirrors the `composed_reviews` row). */
export const ComposedReview = z.object({
  id: z.string(),
  pr_id: z.string(),
  body: z.string(),
  verdict: Verdict.nullable(),
  posted_at: z.string().nullable(),
  github_review_id: z.string().nullable(),
});
export type ComposedReview = z.infer<typeof ComposedReview>;

/** A preview (no GitHub side-effect) of what would be posted. */
export const ComposeReviewPreview = z.object({
  body: z.string(),
  verdict: Verdict,
  inline_comments: z.array(
    z.object({ path: z.string(), line: z.number().int(), body: z.string() }),
  ),
});
export type ComposeReviewPreview = z.infer<typeof ComposeReviewPreview>;

// ===========================================================================
// Export-to-CI + CI Runs
// ===========================================================================

export const CiTarget = z.enum(['gha', 'circle', 'jenkins', 'cli']);
export type CiTarget = z.infer<typeof CiTarget>;

/** One generated file in the CI bundle (path + editable contents). */
export const CiFile = z.object({
  path: z.string(),
  contents: z.string(),
  editable: z.boolean().default(true),
});
export type CiFile = z.infer<typeof CiFile>;

/**
 * AgentManifest — the agent contract shared by the studio and the CI runner.
 *
 * The studio (`CiService.agentYaml`) WRITES this shape to
 * `.devdigest/agents/<slug>.yaml`; the agent-runner READS it. Keeping one Zod
 * schema for both ends guarantees the formats never drift. `skills` are slugs
 * resolved to `.devdigest/skills/<slug>.md`.
 */
export const AgentManifest = z.object({
  name: z.string().min(1),
  provider: Provider.default('openrouter'),
  model: z.string().min(1),
  system_prompt: z.string(),
  // Tolerate both a missing key and an explicit `null` (YAML `skills:` with no
  // value parses to null, which `.default([])` does NOT catch) — normalize both
  // to an empty array so manifests without skills validate cleanly.
  skills: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
  strategy: z.enum(['auto', 'single-pass', 'map-reduce']).default('auto'),
  // CI gate policy (see CiFailOn) — when the posted review should BLOCK
  // (REQUEST_CHANGES + fail the check) vs just comment. Default: block on critical.
  ci_fail_on: CiFailOn.default('critical'),
});
export type AgentManifest = z.infer<typeof AgentManifest>;
/** Caller-facing input type — `.default()` fields stay optional. */
export type AgentManifestInput = z.input<typeof AgentManifest>;

/** Request body for `POST /agents/:id/export-ci`. */
export const CiExportInput = z.object({
  repo: z.string().min(1), // "owner/name"
  target: CiTarget.default('gha'),
  /** "open_pr" opens a PR with the files; "files" just returns/persists them. */
  action: z.enum(['open_pr', 'files']).default('open_pr'),
  post_as: z.enum(['github_review', 'pr_comment', 'none']).default('github_review'),
  triggers: z.array(z.string()).default(['opened', 'synchronize', 'reopened']),
  base: z.string().default('main'),
});
export type CiExportInput = z.infer<typeof CiExportInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type CiExportInputBody = z.input<typeof CiExportInput>;

/** A persisted CI installation (mirrors `ci_installations`). */
export const CiInstallation = z.object({
  id: z.string(),
  agent_id: z.string(),
  repo: z.string(),
  target_type: CiTarget,
  installed_at: z.string(),
});
export type CiInstallation = z.infer<typeof CiInstallation>;

/** Response of `POST /agents/:id/export-ci`. */
export const CiExport = z.object({
  installation: CiInstallation,
  files: z.array(CiFile),
  pr_url: z.string().nullable(),
});
export type CiExport = z.infer<typeof CiExport>;

export const CiRunStatus = z.enum(['succeeded', 'failed', 'no_findings', 'running']);
export type CiRunStatus = z.infer<typeof CiRunStatus>;

/** A CI run row (mirrors `ci_runs`) — ingested from GitHub Actions artifacts. */
export const CiRun = z.object({
  id: z.string(),
  ci_installation_id: z.string().nullable(),
  pr_number: z.number().int().nullable(),
  ran_at: z.string().nullable(),
  status: z.string().nullable(),
  findings_count: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  github_url: z.string().nullable(),
  source: z.string().nullable(),
  agent: z.string().nullish(),
  duration_s: z.number().nullish(),
});
export type CiRun = z.infer<typeof CiRun>;

/**
 * The artifact shape uploaded by the CI action (`devdigest-result.json`).
 * Ingested back on refresh to populate `ci_runs` (L06).
 */
export const CiResultArtifact = z.object({
  findings_count: z.number().int(),
  critical: z.number().int().nullish(),
  warning: z.number().int().nullish(),
  suggestion: z.number().int().nullish(),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int().nullish(),
  agent: z.string(),
  version: z.string().nullish(),
  pr_number: z.number().int().nullish(),
});
export type CiResultArtifact = z.infer<typeof CiResultArtifact>;

// ===========================================================================
// Conformance (PRD ↔ PR) — API record (the analysis shape is `Conformance`)
// ===========================================================================

/** Request body for `POST /pulls/:id/conformance`. */
export const ConformanceInput = z.object({
  /** Spec path/id to compare against; if omitted, the first available spec. */
  spec: z.string().nullish(),
  provider: z.enum(['openai', 'anthropic', 'openrouter']).nullish(),
  model: z.string().nullish(),
});
export type ConformanceInput = z.infer<typeof ConformanceInput>;

/** A persisted conformance check (mirrors `conformance_checks` + the report). */
export const ConformanceReport = z.object({
  id: z.string(),
  pr_id: z.string(),
  report: Conformance,
});
export type ConformanceReport = z.infer<typeof ConformanceReport>;

// ===========================================================================
// Hooks (Secret-Leak + Phantom-API detectors) — emit grounding-exempt findings
// ===========================================================================

export const HookKind = z.enum(['secret_leak', 'phantom']);
export type HookKind = z.infer<typeof HookKind>;

/** Result of running the built-in detectors over a PR. */
export const HookScanResult = z.object({
  pr_id: z.string(),
  review_id: z.string().nullable(),
  findings: z.array(Finding),
});
export type HookScanResult = z.infer<typeof HookScanResult>;
