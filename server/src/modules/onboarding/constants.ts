/**
 * Onboarding tour generator — the module's published surface. Other modules
 * may import from here (never from service/repository/helpers/facts).
 */

/**
 * The five section kinds, in wire order. This array IS the contract with the
 * model: `{{sections}}` in `src/prompts/onboarding.system.md` is rendered
 * FROM this list (never hand-typed in the template), so the prompt and
 * `OnboardingDraft` (helpers.ts) can never drift apart. Order here is also
 * the order sections are assembled in — it mirrors the enum order in
 * `@devdigest/shared`'s `OnboardingSection.kind`.
 */
export const SECTION_KINDS = [
  'architecture_overview',
  'critical_paths',
  'run_locally',
  'reading_path',
  'first_tasks',
] as const;

/**
 * Deterministic, English, structural labels used ONLY when a skeleton is
 * built (`buildSkeleton`) — a skeleton never calls the model (AC-23), so
 * there is no locale-aware text to show. The moment a tour is actually
 * generated, `title` comes from the model instead (see `OnboardingDraft`).
 */
export const SECTION_TITLES: Record<(typeof SECTION_KINDS)[number], string> = {
  architecture_overview: 'Architecture overview',
  critical_paths: 'Critical paths',
  run_locally: 'Run locally',
  reading_path: 'Reading path',
  first_tasks: 'First tasks',
};

/**
 * Root-level files read verbatim for the `run_locally` section — the
 * highest-signal evidence of how a repo is started, same rationale as
 * conventions' `CONFIG_FILES` (`modules/conventions/constants.ts`). A
 * missing file is skipped silently.
 */
export const RUN_CONFIG_FILES = [
  'package.json',
  'README.md',
  'Makefile',
  'docker-compose.yml',
  'docker-compose.yaml',
  '.env.example',
] as const;

/**
 * Monorepo edge case ("scripts collected from root + nearest-to-root"):
 * `<seg>/package.json` is read for each unique first path-segment of the
 * top-ranked files, capped here. Bounded, deterministic, no new I/O
 * primitive — see plan step 6 / edge case table.
 */
export const MAX_MANIFEST_DIRS = 5;

/** How many top-ranked files feed `reading_path` / `critical_paths` / `first_tasks` scanning. */
export const TOP_FILES_N = 12;

/** How many `critical_paths` chains are shown on the wire. */
export const CRITICAL_FILES_SHOWN = 4;

/** Cap on `architecture_overview` links — mirrors the prompt's "up to 4 REAL files". */
export const MAX_ARCHITECTURE_LINKS = 4;

/** Cap on `run_locally` commands shown, in the model's (execution) order — mirrors the prompt's "at most 6" instruction. */
export const MAX_RUN_LOCALLY_LINKS = 6;

/** How many files `reading_path` orders and shows (rank DESC — AC-17). */
export const READING_PATH_LEN = 6;

/** Cap on `first_tasks` entries shown, after post-validation. */
export const MAX_FIRST_TASKS = 5;

/**
 * How many top-ranked files are scanned for `first_tasks` signals (TODO/FIXME
 * markers, missing sibling test). Read-cost bound for one generation:
 * `RUN_CONFIG_FILES.length + MAX_MANIFEST_DIRS` manifest/config reads, plus
 * up to `TASK_SCAN_FILES * (1 + SIBLING_TEST_PROBES)` reads (one file read +
 * up to `SIBLING_TEST_PROBES` sibling-test probes each) — independent of repo
 * size (A14).
 *
 * Larger than `TOP_FILES_N` on purpose (the scan is meant to look further
 * down the rank than `reading_path`/`critical_paths` show): `facts.ts` fetches
 * `getTopFilesByRank(repoId, Math.max(TOP_FILES_N, TASK_SCAN_FILES))` ONCE and
 * slices the same result for both consumers — fetching only `TOP_FILES_N` and
 * then slicing to `TASK_SCAN_FILES` would silently cap the scan at
 * `TOP_FILES_N`, which is exactly the no-op this constant used to be.
 */
export const TASK_SCAN_FILES = 20;

/** Candidate locations probed per scanned file by `siblingTestCandidates` (fixed count). */
export const SIBLING_TEST_PROBES = 7;

/** Per-file read cap in bytes, same bound conventions uses for the same reason. */
export const MAX_FILE_BYTES = 2_000_000;

/** Per-file excerpt clip inside the prompt (A3). */
export const MAX_PROMPT_FILE_CHARS = 4_000;

/** Total facts-block clip inside the prompt, applied after assembly (A3). */
export const MAX_PROMPT_TOTAL_CHARS = 40_000;

/** `completeStructured`'s reprompt-on-error budget; `attempts` never exceeds this + 1. */
export const MAX_STRUCTURED_RETRIES = 2;

/** Names the JSON schema in the provider request (mock adapter fixture key). */
export const SCHEMA_NAME = 'OnboardingTour';

/** Mirrors conventions/skills — the UI keys its disabled action off this. */
export { NO_PROVIDER_KEY_CODE } from '../../platform/errors.js';
