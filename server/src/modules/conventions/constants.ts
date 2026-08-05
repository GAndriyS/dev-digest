/**
 * L03 — conventions extractor constants. The module's published surface: other
 * modules may import from here, never from service/repository/helpers.
 */

/**
 * Config files pulled into the sample verbatim. They are the highest-signal
 * evidence in a repo — a lint rule or a compiler flag IS a house rule, already
 * written down and machine-enforced — and `getConventionSamples` deliberately
 * excludes them (it ranks source files and filters configs out as junk), so the
 * two sources complement rather than overlap.
 *
 * Matched against the clone root only; a missing file is skipped silently.
 */
export const CONFIG_FILES = [
  'eslint.config.js',
  'eslint.config.mjs',
  '.eslintrc.json',
  '.eslintrc.cjs',
  'tsconfig.json',
  '.prettierrc',
  '.prettierrc.json',
  'prettier.config.js',
  '.editorconfig',
] as const;

/**
 * How many ranked source files to sample. Twelve is the spec's number and is
 * bounded by prompt cost, not by ambition: conventions repeat, so the top of the
 * rank shows the same shapes the tail would.
 */
export const SAMPLE_COUNT = 12;

/**
 * Per-file read cap. A vendored bundle or a generated client can be megabytes;
 * truncating keeps one scan inside a sane token budget. Conventions live at the
 * top of a file (imports, exports, the first handler), so the head is the part
 * worth reading.
 */
export const MAX_FILE_CHARS = 6_000;

/** Upper bound on candidates asked of the model — a rubric, not a transcript. */
export const MAX_CANDIDATES = 8;

/**
 * Shortest snippet that counts as evidence, after whitespace normalization.
 *
 * Without a floor the gate is far weaker than it looks: matching is per-line
 * containment, so a snippet of `}` or `const` occurs in almost any file, and a
 * model could attach a ubiquitous fragment to an invented rule and pass. The
 * point of the gate is that evidence is SPECIFIC to the claim; a fragment that
 * matches everywhere identifies nothing.
 */
export const MIN_SNIPPET_CHARS = 15;

/**
 * Names the JSON schema in the provider request. The mock LLM adapter keys its
 * per-call fixtures off this exact string (`structuredBySchema`), so tests can
 * drive the extractor without a network call.
 */
export const EXTRACTION_SCHEMA_NAME = 'ConventionExtraction';

/** Mirrors the skills module — the UI keys its disabled Run button off this. */
export const NO_PROVIDER_KEY_CODE = 'no_provider_key';

/** Thrown when the repo has never been cloned, so there is nothing to read. */
export const REPO_NOT_CLONED_CODE = 'repo_not_cloned';

/** Thrown when neither ranked samples nor config files could be read. */
export const NO_SAMPLES_CODE = 'no_samples';

export const EXTRACTION_SYSTEM_PROMPT = `You are a senior engineer documenting a codebase's HOUSE RULES for a code reviewer.

You will be shown excerpts from real files in one repository. Identify conventions that the code CONSISTENTLY follows — patterns a reviewer should enforce on new pull requests.

Rules for your output:
- Report at most ${MAX_CANDIDATES} conventions. Fewer is better than padding.
- Each rule must be a single directive sentence a reviewer can act on ("Route handlers return typed Result<T, ApiError>"), not an observation ("the code uses TypeScript").
- Every rule MUST be backed by evidence copied VERBATIM from one of the excerpts: \`evidence_path\` is that file's exact path as given, and \`evidence_snippet\` is 1-5 lines copied character-for-character from it. Do NOT paraphrase, reformat, or invent the snippet — it is checked against the real file and a rule whose snippet cannot be found is discarded.
- \`category\` is one short lowercase word grouping the rule: naming, structure, errors, types, async, imports, testing, security, style.
- \`confidence\` is 0..1: how consistently the repo follows this, based on what you were shown.
- Skip anything that is merely the language's or framework's default. Report what THIS repo decided.`;
