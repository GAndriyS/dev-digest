import { z } from 'zod';

/**
 * Conformance, Onboarding, Eval, Memory, Conventions, Skills,
 * Agents and their DTOs.
 */

// ---- Conformance ----
export const ConformanceStatus = z.enum(['implemented', 'missing', 'out_of_scope']);
export type ConformanceStatus = z.infer<typeof ConformanceStatus>;

export const ConformanceItem = z.object({
  requirement: z.string(),
  status: ConformanceStatus,
  evidence_file: z.string().nullish(),
  notes: z.string().nullish(),
});
export type ConformanceItem = z.infer<typeof ConformanceItem>;

export const Conformance = z.object({
  spec_id: z.string(),
  spec_title: z.string(),
  items: z.array(ConformanceItem),
  completeness_pct: z.number().min(0).max(100),
});
export type Conformance = z.infer<typeof Conformance>;

// ---- Onboarding ----
export const OnboardingLink = z.object({
  label: z.string(),
  path: z.string(),
});
export type OnboardingLink = z.infer<typeof OnboardingLink>;

export const OnboardingSection = z.object({
  kind: z.string(),
  title: z.string(),
  body: z.string(), // markdown
  diagram: z.string().nullish(), // mermaid
  links: z.array(OnboardingLink),
});
export type OnboardingSection = z.infer<typeof OnboardingSection>;

export const Onboarding = z.object({
  sections: z.array(OnboardingSection),
});
export type Onboarding = z.infer<typeof Onboarding>;

// ---- Eval ----
export const EvalPerTrace = z.object({
  name: z.string(),
  pass: z.boolean(),
  expected: z.unknown(),
  actual: z.unknown(),
});
export type EvalPerTrace = z.infer<typeof EvalPerTrace>;

export const EvalRun = z.object({
  recall: z.number().min(0).max(1),
  precision: z.number().min(0).max(1),
  citation_accuracy: z.number().min(0).max(1),
  traces_passed: z.number().int(),
  traces_total: z.number().int(),
  duration_ms: z.number().int(),
  cost_usd: z.number().nullable(),
  per_trace: z.array(EvalPerTrace),
});
export type EvalRun = z.infer<typeof EvalRun>;

export const EvalOwnerKind = z.enum(['skill', 'agent']);
export type EvalOwnerKind = z.infer<typeof EvalOwnerKind>;

export const EvalCase = z.object({
  id: z.string(),
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string(),
  input_diff: z.string(),
  input_files: z.unknown(),
  input_meta: z.unknown(),
  expected_output: z.unknown(),
  notes: z.string().nullish(),
});
export type EvalCase = z.infer<typeof EvalCase>;

// ---- Memory ----
export const MemoryScope = z.enum(['repo', 'global', 'team']);
export type MemoryScope = z.infer<typeof MemoryScope>;

export const MemoryKind = z.enum([
  'decision',
  'convention',
  'preference',
  'fact',
  'learning',
]);
export type MemoryKind = z.infer<typeof MemoryKind>;

export const MemorySource = z.object({
  pr: z.number().int().nullish(),
  context: z.string(),
});
export type MemorySource = z.infer<typeof MemorySource>;

export const MemoryItem = z.object({
  content: z.string(),
  scope: MemoryScope,
  kind: MemoryKind,
  confidence: z.number().min(0).max(1),
  sources: z.array(MemorySource),
});
export type MemoryItem = z.infer<typeof MemoryItem>;

// ---- Skills ----
export const SkillType = z.enum(['rubric', 'convention', 'security', 'custom']);
export type SkillType = z.infer<typeof SkillType>;

export const SkillSource = z.enum(['manual', 'imported_url', 'extracted', 'community']);
export type SkillSource = z.infer<typeof SkillSource>;

export const Skill = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  type: SkillType,
  source: SkillSource,
  body: z.string(),
  enabled: z.boolean(),
  version: z.number().int(),
  evidence_files: z.array(z.string()).nullish(),
});
export type Skill = z.infer<typeof Skill>;

export const CommunitySkill = z.object({
  name: z.string(),
  repo: z.string(),
  stars: z.number().int(),
  lang: z.string(),
  desc: z.string(),
});
export type CommunitySkill = z.infer<typeof CommunitySkill>;

/**
 * Create payload. `source` is a provenance label, not a behaviour switch — the
 * only flow that writes anything but 'manual' today is the conventions
 * extractor ('extracted', with evidence_files).
 */
export const SkillInput = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  type: SkillType.default('custom'),
  source: SkillSource.default('manual'),
  body: z.string().min(1),
  enabled: z.boolean().default(true),
  evidence_files: z.array(z.string()).nullish(),
});
export type SkillInput = z.infer<typeof SkillInput>;

/**
 * Update payload. Changing `body` mints a new immutable version (the UI copy
 * promises exactly that); metadata-only edits leave the version alone, so
 * renaming a skill does not invalidate an eval run that scored its text.
 */
export const SkillPatch = SkillInput.partial();
export type SkillPatch = z.infer<typeof SkillPatch>;

/** One entry in a skill's immutable body history. `body` is omitted in lists. */
export const SkillVersion = z.object({
  skill_id: z.string(),
  version: z.number().int(),
  body: z.string().nullish(),
  body_chars: z.number().int(),
  created_at: z.string(),
});
export type SkillVersion = z.infer<typeof SkillVersion>;

/** An agent that has this skill linked, with its position in the prompt. */
export const SkillUsage = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  order: z.number().int(),
  agent_enabled: z.boolean(),
});
export type SkillUsage = z.infer<typeof SkillUsage>;

/**
 * Skill dashboard numbers. Attribution is RUN-level, not finding-level: the
 * engine renders every linked skill into one `## Skills / rules` block, so a
 * finding cannot honestly be traced to one skill. `findings_30d` therefore
 * counts findings from runs that INCLUDED this skill — a correlation, and the
 * UI says so. Per-finding attribution would require the model to cite the
 * skill, which it is not asked to do.
 */
export const SkillStats = z.object({
  used_by: z.array(SkillUsage),
  pull_count_30d: z.number().int(),
  runs_total: z.number().int(),
  findings_30d: z.number().int(),
  /** accepted / (accepted + dismissed), 0..1, or null when nothing was triaged. */
  accept_rate: z.number().min(0).max(1).nullish(),
  findings_by_category: z.array(
    z.object({ category: z.string(), count: z.number().int() }),
  ),
});
export type SkillStats = z.infer<typeof SkillStats>;

// ---- Skill import ----

/**
 * Import request. The file arrives base64-encoded inside a normal JSON body so
 * one contract carries both a text `.md` and a binary `.zip` without dragging a
 * multipart parser into the edge. `filename` is what the extension is read from
 * — the bytes are never sniffed — so it must be the real name the user picked.
 *
 * The route caps the encoded length; a data-URL prefix (`data:...;base64,`), as
 * produced by `FileReader.readAsDataURL`, is tolerated and stripped.
 */
export const SkillImportRequest = z.object({
  filename: z.string().min(1),
  content_base64: z.string().min(1),
});
export type SkillImportRequest = z.infer<typeof SkillImportRequest>;

/**
 * Import PREVIEW — the extracted skill core, persisted nowhere.
 *
 * `POST /skills/import/preview` only reads: no row is written, no file is
 * unpacked to disk, and nothing in the archive is executed. Confirmation is the
 * ordinary `POST /skills` — the client posts these fields back (adding
 * `source: 'imported_url'`), so an unconfirmed import leaves no trace.
 *
 * `source_files` are the markdown entries the preview drew from, the one that
 * produced `body` first. `skipped_files` are entries that were deliberately not
 * read — executables, images, anything that is not markdown. Showing them is the
 * point: the user sees exactly what was ignored.
 */
export const SkillImportPreview = z.object({
  name: z.string(),
  description: z.string(),
  type: SkillType,
  body: z.string(),
  source_files: z.array(z.string()),
  skipped_files: z.array(z.string()),
});
export type SkillImportPreview = z.infer<typeof SkillImportPreview>;

// ---- Conventions ----
/**
 * Tri-state rather than an `accepted` boolean: a re-scan must tell a rejected
 * rule apart from an unreviewed one, or every rejection reappears next scan.
 */
export const ConventionStatus = z.enum(['pending', 'accepted', 'rejected']);
export type ConventionStatus = z.infer<typeof ConventionStatus>;

/**
 * One extracted house-rule with its proof. `evidence_line` is derived by the
 * server from where the snippet actually occurs in the file — never the model's
 * own count — which is what lets the UI deep-link to real code on GitHub.
 * A candidate whose snippet could not be located is dropped, never stored.
 */
export const ConventionCandidate = z.object({
  id: z.string(),
  // Bounded because the model fills it and the UI renders it verbatim as a
  // badge: an unconstrained string lets a returned sentence become a label.
  category: z.string().min(1).max(32),
  rule: z.string(),
  evidence_path: z.string(),
  evidence_snippet: z.string(),
  evidence_line: z.number().int().nullable(),
  confidence: z.number().min(0).max(1),
  status: ConventionStatus,
});
export type ConventionCandidate = z.infer<typeof ConventionCandidate>;

/**
 * Accept/reject, or correct the rule's wording before it becomes a skill.
 *
 * `.strict()` and the refinement together close a silent-success hole: zod
 * strips unknown keys by default, so `{"staus":"accepted"}` would otherwise
 * validate, hit the no-op branch, and answer 200 having changed nothing. A
 * typo at the wire boundary should 422, not look like it worked.
 */
export const ConventionPatch = z
  .object({
    rule: z.string().min(1),
    status: ConventionStatus,
  })
  .partial()
  .strict()
  .refine((v) => v.rule !== undefined || v.status !== undefined, {
    message: 'Provide at least one of: rule, status',
  });
export type ConventionPatch = z.infer<typeof ConventionPatch>;

/**
 * Extraction outcome. `dropped_no_evidence` is reported rather than silently
 * swallowed: it is the honest measure of how much the model made up, and the
 * UI shows it so a bad scan looks like a bad scan.
 */
export const ConventionExtractResult = z.object({
  candidates: z.array(ConventionCandidate),
  sampled_files: z.array(z.string()),
  dropped_no_evidence: z.number().int(),
});
export type ConventionExtractResult = z.infer<typeof ConventionExtractResult>;

// ---- Agents ----
// 'openrouter' routes through the OpenAI-compatible API (OpenAIProvider with a
// custom baseURL) — used by the CI runner for cheap models (DeepSeek/GLM/MiniMax).
export const Provider = z.enum(['openai', 'anthropic', 'openrouter']);
export type Provider = z.infer<typeof Provider>;

// Review execution strategy (matches @devdigest/reviewer-core's ReviewStrategy):
//  - single-pass: send the WHOLE diff in ONE model call (default)
//  - map-reduce:  one model call PER changed file (for very large diffs)
//  - auto:        single-pass, switching to map-reduce when the diff is large
export const ReviewStrategy = z.enum(['single-pass', 'map-reduce', 'auto']);
export type ReviewStrategy = z.infer<typeof ReviewStrategy>;

// CI gate policy — when a review should BLOCK (REQUEST_CHANGES + fail the check)
// vs just comment. Deterministic from finding severities, NOT the model's verdict:
//  - never:    never block, always comment (advisory only)
//  - critical: block iff >=1 CRITICAL finding (default)
//  - warning:  block iff >=1 WARNING or CRITICAL finding
//  - any:      block iff >=1 finding of any severity
export const CiFailOn = z.enum(['never', 'critical', 'warning', 'any']);
export type CiFailOn = z.infer<typeof CiFailOn>;

export const Agent = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  enabled: z.boolean(),
  version: z.number().int(),
  strategy: ReviewStrategy.default('single-pass'),
  ci_fail_on: CiFailOn.default('critical'),
  // Inject repo-intel context (repo skeleton + callers + rank note) into this
  // agent's review prompt. Default on; gated again by the global flag.
  repo_intel: z.boolean().default(true),
});
export type Agent = z.infer<typeof Agent>;

export const AgentSkillLink = z.object({
  agent_id: z.string(),
  skill_id: z.string(),
  order: z.number().int(),
});
export type AgentSkillLink = z.infer<typeof AgentSkillLink>;

// The immutable config snapshot captured in `agent_versions` whenever an agent's
// config changes (everything but `enabled`). Mirrors the shape written by the
// agents repository — provider/model/prompt/output_schema/strategy/gate/repo_intel
// plus the ordered skill ids linked at snapshot time. Used for reproducibility
// (eval replays a past version) and for surfacing an agent's edit history.
export const AgentVersionConfig = z.object({
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  strategy: ReviewStrategy,
  ci_fail_on: CiFailOn,
  repo_intel: z.boolean(),
  skills: z.array(z.string()),
});
export type AgentVersionConfig = z.infer<typeof AgentVersionConfig>;

export const AgentVersion = z.object({
  agent_id: z.string(),
  version: z.number().int(),
  config: AgentVersionConfig,
  created_at: z.string(),
});
export type AgentVersion = z.infer<typeof AgentVersion>;
