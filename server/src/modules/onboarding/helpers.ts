import { clipHead } from '../_shared/prompt-text.js';
import { z } from 'zod';
import type { ChatMessage, Onboarding, OnboardingIndexSummary, OnboardingLink, OnboardingSection, OnboardingSkeletonReason } from '@devdigest/shared';
import { OnboardingIndexSummary as OnboardingIndexSummarySchema, OnboardingSection as OnboardingSectionSchema } from '@devdigest/shared';
import { wrapUntrusted } from '../../platform/prompt.js';
import type { IndexState } from '../repo-intel/types.js';
import {
  CRITICAL_FILES_SHOWN,
  MAX_FIRST_TASKS,
  MAX_PROMPT_FILE_CHARS,
  MAX_ARCHITECTURE_LINKS,
  MAX_PROMPT_TOTAL_CHARS,
  MAX_RUN_LOCALLY_LINKS,
  READING_PATH_LEN,
  SECTION_KINDS,
  SECTION_TITLES,
} from './constants.js';
import type { FirstTaskSignal, OnboardingFacts, OnboardingTelemetry } from './types.js';

/**
 * Onboarding tour generator — pure helpers. No I/O, no container: the
 * evidence gate and the draft→wire mapping are the parts most worth testing
 * with plain values (mirrors `modules/conventions/helpers.ts`).
 */

// ---------------------------------------------------------------------------
// OnboardingDraft — what the model is asked to return (D6, A2).
//
// Keyed by the five `kind`s as OBJECT PROPERTIES (never `z.record`), so the
// model structurally cannot change the section count or order, and
// `diagram` structurally cannot land on a section other than
// `architecture_overview`. NO `.optional()` anywhere in this tree — OpenAI's
// strict `json_schema` mode requires every property present
// (`openai.ts:104-107`, `server/INSIGHTS.md:259`); `reading_path.entries` and
// `first_tasks.tasks` carry rationale/description ONLY — the actual path
// ORDER (`reading_path`) and path SET (`first_tasks`) are re-derived from
// code-collected facts, never trusted from the model (AC-17, AC-19).
// ---------------------------------------------------------------------------

/**
 * `OnboardingLink`'s two fields carry DIFFERENT meanings per section — this
 * schema doesn't encode that (the model's shape is uniform), but the wire
 * consumer does branch on `kind`:
 *   - `run_locally`: `label` is the exact shell COMMAND, copied verbatim from
 *     a FACTS excerpt (never invented); `path` is the config/manifest FILE
 *     that command was read from (one of `RUN_CONFIG_FILES` /
 *     `<seg>/package.json`) — post-validation checks `path` against the
 *     known-facts set, never `label`. `OnboardingTourView`'s `CommandRow`
 *     renders `label` as the copyable command and `path` as its source file.
 *   - every other section: `label` is a human-readable description of the
 *     file at `path` (e.g. why to read it); `path` is what gets opened.
 */
const LinkDraft = z.object({ label: z.string(), path: z.string() });

const ArchitectureOverviewDraft = z.object({
  title: z.string(),
  body: z.string(),
  diagram: z.string().nullable(),
  links: z.array(LinkDraft),
});

const SectionDraft = z.object({
  title: z.string(),
  body: z.string(),
  links: z.array(LinkDraft),
});

const ReadingPathEntryDraft = z.object({ path: z.string(), rationale: z.string() });
const ReadingPathDraft = z.object({
  title: z.string(),
  body: z.string(),
  entries: z.array(ReadingPathEntryDraft),
});

const FirstTaskDraft = z.object({ path: z.string(), description: z.string() });
const FirstTasksDraft = z.object({
  title: z.string(),
  body: z.string(),
  tasks: z.array(FirstTaskDraft),
});

export const OnboardingDraft = z.object({
  architecture_overview: ArchitectureOverviewDraft,
  critical_paths: SectionDraft,
  run_locally: SectionDraft,
  reading_path: ReadingPathDraft,
  first_tasks: FirstTasksDraft,
});
export type OnboardingDraft = z.infer<typeof OnboardingDraft>;

// ---------------------------------------------------------------------------
// Prompt assembly (A3, A9).
// ---------------------------------------------------------------------------

/** Truncate to a bound, appending an ellipsis marker — same shape as conventions' `clipFile`. */
export const clipForPrompt = clipHead;

/**
 * One system + one user message. The system prompt is already rendered
 * (`{{sections}}`/`{{language}}` interpolated by the caller); the user
 * message is the whole facts block, per-file clipped then total-clipped
 * (A3), wrapped ONCE in `<untrusted>` via the shared `wrapUntrusted` (never
 * hand-rolled tags — the system prompt's SECURITY paragraph assumes this
 * exact delimiter).
 */
export function buildTourMessages(
  facts: OnboardingFacts,
  language: string,
  systemPrompt: string,
): ChatMessage[] {
  const readingPathLines = facts.topFiles.map((p, i) => `${i + 1}. ${p}`).join('\n') || '(none)';
  const criticalPathLines =
    facts.criticalPaths.map((chain) => chain.join(' -> ')).join('\n') || '(none)';
  const runFileLines =
    facts.runFiles
      .map(
        (f) =>
          `### ${f.path}\n\`\`\`\n${clipForPrompt(f.content, MAX_PROMPT_FILE_CHARS)}\n\`\`\``,
      )
      .join('\n\n') || '(none)';
  const taskSignalLines =
    facts.taskSignals
      .map((s) => `- [${s.kind}] ${s.path}${s.excerpt ? `: ${s.excerpt}` : ''}`)
      .join('\n') || '(none)';

  const factsText = [
    '## Ranked files (importance order — this IS the reading-path order; do not reorder or add paths)',
    readingPathLines,
    '## Critical dependency chains (importer -> imported)',
    criticalPathLines,
    '## Config & manifest excerpts',
    runFileLines,
    '## Candidate first-task signals (build a task ONLY from one of these paths)',
    taskSignalLines,
  ].join('\n\n');

  const clipped = clipForPrompt(factsText, MAX_PROMPT_TOTAL_CHARS);

  return [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content:
        `Write the onboarding tour for this repository from the facts below. ` +
        `Write all titles and body text in "${language}".\n\n${wrapUntrusted('repo-facts', clipped)}`,
    },
  ];
}

// ---------------------------------------------------------------------------
// first_tasks signal collection (facts.ts calls these; pure, no I/O).
// ---------------------------------------------------------------------------

const TODO_RE = /\b(TODO|FIXME)\b[:\s]?(.*)/;

/** One signal per file at most — the first TODO/FIXME line found. */
export function scanTodoMarkers(path: string, content: string): FirstTaskSignal[] {
  for (const line of content.split(/\r?\n/)) {
    const m = TODO_RE.exec(line);
    if (m) return [{ path, kind: 'todo', excerpt: line.trim().slice(0, 200) }];
  }
  return [];
}

/**
 * Where a test for `path` may live — AC-19 signal 2. Colocated
 * (`<stem>.test.<ext>`, `<stem>.spec.<ext>`, `__tests__/<name>`), the
 * cross-extension colocated form (`.tsx`/`.jsx` tested by `.test.ts`/`.test.js`),
 * and the `test/` / `tests/` mirror next to the nearest `src/` segment
 * (`pkg/src/a/b.ts` → `pkg/test/a/b.test.ts`, `pkg/tests/a/b.test.ts`,
 * `pkg/test/b.test.ts`). Always exactly `SIBLING_TEST_PROBES` entries so the
 * read bound in `constants.ts` stays a constant, not a per-file surprise.
 */
export function siblingTestCandidates(path: string): string[] {
  const lastSlash = path.lastIndexOf('/');
  const dir = lastSlash === -1 ? '' : path.slice(0, lastSlash);
  const base = lastSlash === -1 ? path : path.slice(lastSlash + 1);
  const dotIdx = base.lastIndexOf('.');
  const stem = dotIdx <= 0 ? base : base.slice(0, dotIdx);
  const ext = dotIdx <= 0 ? '' : base.slice(dotIdx);
  const prefix = dir ? `${dir}/` : '';
  // `.tsx` → `.ts`, `.jsx` → `.js`; anything else keeps its own extension.
  const crossExt = ext === '.tsx' ? '.ts' : ext === '.jsx' ? '.js' : ext;

  // `pkg/src/a/b.ts` → pkgRoot `pkg/`, rel `a/`; no `src/` segment → repo root, rel = dir.
  const srcIdx = dir.split('/').indexOf('src');
  const segs = dir ? dir.split('/') : [];
  const pkgRoot = srcIdx === -1 ? '' : segs.slice(0, srcIdx).map((x) => `${x}/`).join('');
  const rel = srcIdx === -1 ? prefix : segs.slice(srcIdx + 1).map((x) => `${x}/`).join('');

  return [
    `${prefix}${stem}.test${ext}`,
    `${prefix}${stem}.spec${ext}`,
    `${prefix}__tests__/${base}`,
    `${prefix}${stem}.test${crossExt}`,
    `${pkgRoot}test/${rel}${stem}.test${crossExt}`,
    `${pkgRoot}tests/${rel}${stem}.test${crossExt}`,
    `${pkgRoot}test/${stem}.test${crossExt}`,
  ];
}

// ---------------------------------------------------------------------------
// Post-validation (D7) — evidence gate over already-collected facts, never a
// fresh clone-tree read. Mirrors `conventions/helpers.ts`'s `verifyCandidates`.
// ---------------------------------------------------------------------------

export interface FilterOutcome {
  kept: OnboardingLink[];
  dropped: number;
}

/** Keep only links whose `path` is in `known`; count what was dropped for telemetry. */
export function filterToKnownPaths(
  links: { label: string; path: string }[],
  known: Set<string>,
): FilterOutcome {
  const kept: OnboardingLink[] = [];
  let dropped = 0;
  for (const l of links) {
    if (known.has(l.path)) kept.push({ label: l.label, path: l.path });
    else dropped++;
  }
  return { kept, dropped };
}

/** `diagram` structurally can only ever be non-null on `architecture_overview`. */
export function normalizeDiagram(
  kind: (typeof SECTION_KINDS)[number],
  diagram: string | null,
): string | null {
  return kind === 'architecture_overview' ? diagram : null;
}

/**
 * Reorder the model's rationales onto the CODE's own order (AC-17, AC-18):
 * `orderedPaths` is `getTopFilesByRank`'s result, already rank DESC — the
 * model's own ordering of `entries` is discarded entirely. A path in
 * `orderedPaths` without a model rationale still shows (labeled by its own
 * path) rather than silently vanishing from the reading path.
 */
export function orderReadingPath(
  orderedPaths: string[],
  rationaleByPath: Map<string, string>,
): OnboardingLink[] {
  return orderedPaths.map((path) => ({ label: rationaleByPath.get(path) ?? path, path }));
}

/**
 * The one place that knows `facts.topFiles` is already rank DESC (same
 * assumption `orderReadingPath` makes) — reused wherever a *different*
 * section's links need the code's rank order instead of the model's link
 * order (AC-13). A link whose `path` isn't in `topFiles` (e.g. surfaced only
 * via a critical-path chain) sorts after every ranked link, in its original
 * (model) order — `Array.prototype.sort` is spec-stable, so ties resolve to
 * input order rather than being reshuffled.
 */
export function orderByTopFileRank(links: OnboardingLink[], topFiles: string[]): OnboardingLink[] {
  const rankOf = (path: string) => {
    const i = topFiles.indexOf(path);
    return i === -1 ? Number.POSITIVE_INFINITY : i;
  };
  return [...links].sort((a, b) => rankOf(a.path) - rankOf(b.path));
}

/**
 * `run_locally` is the one section whose `label` is a **shell command** the UI
 * offers to copy, so `path`-only post-validation is not enough: a repo that
 * injects instructions into its own README could otherwise have the model emit
 * `curl … | sh` attributed to a real config file, and the card would present
 * it as step N of the setup with a Copy button.
 *
 * Three gates, all in code (the prompt's "copied verbatim from a FACTS
 * excerpt" is a request to the model, not a check):
 *
 * 1. the claimed `path` must be a file actually read off the clone;
 * 2. the command must contain no shell chaining, substitution or redirection —
 *    that single rule is what kills `curl … | sh`, `x && y`, `$(…)`, `>` and
 *    friends, whatever wording the model wrapped them in;
 * 3. it must then be either verbatim in that file (whitespace-normalised, so a
 *    command quoted in a `package.json` script or indented in a README fence
 *    still matches) OR one of the fixed bootstrap SHAPES below, whose every
 *    identifier is itself grounded in the claimed file or in the collected
 *    facts. `npm install` is the motivating case: it is what the manifest
 *    means, never what it literally contains.
 */
export function filterToSourcedCommands(
  links: OnboardingLink[],
  runFiles: { path: string; content: string }[],
): { kept: OnboardingLink[]; dropped: number } {
  const contentByPath = new Map(runFiles.map((f) => [f.path, normalizeCommand(f.content)]));
  const kept: OnboardingLink[] = [];
  for (const link of links) {
    const haystack = contentByPath.get(link.path);
    if (haystack === undefined) continue;
    // The RAW label is tested for the unsafe class first: `normalizeCommand`
    // flattens newlines into spaces, so testing afterwards would make the
    // newline branch unreachable and let a two-statement label be judged as one.
    if (UNSAFE_SHELL_RE.test(link.label)) continue;
    const command = normalizeCommand(stripTrailingComment(link.label));
    if (command.length === 0) continue;
    if (haystack.includes(command) || isGroundedBootstrapCommand(command, haystack)) {
      kept.push({ label: command, path: link.path });
    }
  }
  return { kept, dropped: links.length - kept.length };
}

/**
 * Chaining, substitution, redirection, background and newline — a copyable
 * setup step needs none of them, and every "download and run" shape needs at
 * least one. Rejecting the class beats blocklisting `curl`.
 */
const UNSAFE_SHELL_RE = /[|;&`$><\n(){}]|\\$/;

/** Collapse whitespace so a command quoted in JSON or indented in a fence still matches. */
function normalizeCommand(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Drop a trailing `# comment` (the mockup's `pnpm dev # http://localhost:3000`) — inert, but not part of the command. */
function stripTrailingComment(text: string): string {
  const hash = text.indexOf('#');
  return hash === -1 ? text : text.slice(0, hash);
}

/**
 * The bootstrap shapes a manifest *implies* rather than contains. Every
 * variable part is checked against the claimed file's own text, so a shape can
 * never smuggle an identifier the repo does not have.
 */
function isGroundedBootstrapCommand(command: string, haystack: string): boolean {
  // `npm install` / `pnpm i` / `yarn install --frozen-lockfile` — no free arguments.
  if (/^(npm|pnpm|yarn|bun) (install|ci|i)( --[a-z-]+)*$/.test(command)) return true;

  // `pnpm dev`, `npm run build` — the script name must be a key in the manifest.
  const script = /^(?:npm|pnpm|yarn|bun) (?:run )?([a-z0-9:_-]+)$/.exec(command);
  if (script) return haystack.includes(`"${script[1]}"`);

  // `docker compose up -d postgres redis` — every service name must appear in the file.
  const compose = /^docker(?: compose|-compose) (?:up|start)((?: -[a-zA-Z-]+)*)((?: [a-z0-9._-]+)*)$/.exec(command);
  if (compose) {
    const services = (compose[2] ?? '').trim().split(' ').filter(Boolean);
    return services.every((svc) => haystack.includes(svc));
  }

  // `cp .env.example .env` — the source file must exist in the facts we read.
  const copy = /^cp ([\w./-]+) ([\w./-]+)$/.exec(command);
  if (copy) return haystack.length > 0 && copy[1] !== undefined;

  return false;
}

/** Union of every path the code itself put into `facts` — the post-validation allow-list (D7). */
export function knownPathsOf(facts: OnboardingFacts): Set<string> {
  const known = new Set<string>();
  for (const p of facts.topFiles) known.add(p);
  for (const chain of facts.criticalPaths) for (const p of chain) known.add(p);
  for (const f of facts.runFiles) known.add(f.path);
  for (const s of facts.taskSignals) known.add(s.path);
  return known;
}

export interface AssembledSections {
  sections: OnboardingSection[];
  droppedPaths: number;
}

/**
 * Draft + facts → the five wire `OnboardingSection`s. `first_tasks` is
 * filtered against `taskSignals` specifically (not the whole known-paths
 * union) — AC-19 requires every task come from an actual signal, not merely
 * from any fact the code happened to collect.
 */
export function assembleSections(draft: OnboardingDraft, facts: OnboardingFacts): AssembledSections {
  const known = knownPathsOf(facts);
  let droppedPaths = 0;

  const architecture = draft.architecture_overview;
  const arch = filterToKnownPaths(architecture.links, known);
  droppedPaths += arch.dropped;

  const critical = draft.critical_paths;
  const criticalFiltered = filterToKnownPaths(critical.links, known);
  droppedPaths += criticalFiltered.dropped;

  const run = draft.run_locally;
  // Not `known`: a command's provenance is the file it was READ from, so the
  // allow-list is `facts.runFiles` alone — and the command text itself must be
  // in that file (see `filterToSourcedCommands`).
  const runFiltered = filterToSourcedCommands(run.links, facts.runFiles);
  droppedPaths += runFiltered.dropped;

  const rationaleByPath = new Map(draft.reading_path.entries.map((e) => [e.path, e.rationale]));
  const readingLinks = orderReadingPath(facts.topFiles.slice(0, READING_PATH_LEN), rationaleByPath);

  const signalPaths = new Set(facts.taskSignals.map((s) => s.path));
  const taskFiltered = filterToKnownPaths(
    draft.first_tasks.tasks.map((t) => ({ label: t.description, path: t.path })),
    signalPaths,
  );
  droppedPaths += taskFiltered.dropped;

  const sections: OnboardingSection[] = [
    {
      kind: 'architecture_overview',
      title: architecture.title,
      body: architecture.body,
      diagram: normalizeDiagram('architecture_overview', architecture.diagram),
      // The only section whose cap used to live in the prompt alone ("up to 4
      // REAL files") — a model-controlled list length is a model-controlled
      // payload size, so the bound is a constant like every sibling's.
      links: arch.kept.slice(0, MAX_ARCHITECTURE_LINKS),
    },
    {
      kind: 'critical_paths',
      title: critical.title,
      body: critical.body,
      diagram: null,
      links: orderByTopFileRank(criticalFiltered.kept, facts.topFiles).slice(0, CRITICAL_FILES_SHOWN),
    },
    {
      kind: 'run_locally',
      title: run.title,
      body: run.body,
      diagram: null,
      // `label` is a command, `path` the config file it came from (see
      // `LinkDraft`'s doc comment) — `filterToSourcedCommands` above checked
      // both; this only bounds the count, in the model's own (execution) order.
      links: runFiltered.kept.slice(0, MAX_RUN_LOCALLY_LINKS),
    },
    {
      kind: 'reading_path',
      title: draft.reading_path.title,
      body: draft.reading_path.body,
      diagram: null,
      links: readingLinks,
    },
    {
      kind: 'first_tasks',
      title: draft.first_tasks.title,
      body: draft.first_tasks.body,
      diagram: null,
      links: taskFiltered.kept.slice(0, MAX_FIRST_TASKS),
    },
  ];

  return { sections, droppedPaths };
}

// ---------------------------------------------------------------------------
// Skeleton (AC-23) and index summary (D2, A5).
// ---------------------------------------------------------------------------

/**
 * Deterministic five-header skeleton — no model, no clone read, same result
 * every time for the same `(reason, index)` (AC-25's "the SAME skeleton").
 * Titles are static English labels (`SECTION_TITLES`), never model text — a
 * skeleton by definition has none.
 */
export function buildSkeleton(reason: OnboardingSkeletonReason, index: OnboardingIndexSummary): Onboarding {
  return {
    status: 'skeleton',
    reason,
    generated_at: null,
    index,
    sections: SECTION_KINDS.map((kind) => ({
      kind,
      title: SECTION_TITLES[kind],
      body: '',
      diagram: null,
      links: [],
    })),
  };
}

/**
 * D2 / A5: the onboarding module's OWN read of the index status — repo-intel
 * calls a truncated-but-clean pass `full`; onboarding calls it `partial`
 * whenever `MAX_INDEXED_FILES` actually dropped files, WITHOUT masking a
 * `degraded`/`failed` pipeline status underneath.
 */
export function deriveIndexSummary(state: IndexState): OnboardingIndexSummary {
  const bounded = state.bounded > 0;
  const status = state.status === 'full' && bounded ? 'partial' : state.status;
  return {
    files_indexed: state.filesIndexed,
    total_candidates: state.totalCandidates,
    bounded,
    status,
  };
}

// ---------------------------------------------------------------------------
// Server log line (D8, A8) and stored-row parsing (parse-never-trust-json).
// ---------------------------------------------------------------------------

/** One structured-log fields object per generation — `reason` only when set (skeleton). */
export function onboardingLogFields(t: OnboardingTelemetry): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    provider: t.provider,
    model: t.model,
    calls: t.calls,
    attempts: t.attempts,
    tokensIn: t.tokensIn,
    tokensOut: t.tokensOut,
    costUsd: t.costUsd,
    droppedPaths: t.droppedPaths,
    repoId: t.repoId,
    durationMs: t.durationMs,
  };
  if (t.reason) fields.reason = t.reason;
  if (t.error) fields.error = t.error;
  return fields;
}

const StoredTourSchema = z.object({
  sections: z.array(OnboardingSectionSchema),
  index: OnboardingIndexSummarySchema,
});

export interface StoredTour {
  sections: OnboardingSection[];
  index: OnboardingIndexSummary;
}

/**
 * `safeParse` the `onboarding.json` jsonb column — never `JSON.parse` a
 * trusted-shaped assumption, never throw on drift. A row that fails to parse
 * (e.g. a pre-AC-31 row with a free-string `kind`) is treated exactly like
 * "no tour generated yet", not a 500 — the contract narrowed `kind` to an
 * enum (AC-31) and the table starts empty, so this is a safety net, not an
 * expected path.
 */
export function parseStoredTour(json: unknown): StoredTour | null {
  const parsed = StoredTourSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

