/**
 * Project Context (L05/SPEC-01) — module constants.
 *
 * Configured ROOT NAMES (`specs`, `docs`, `insights` by default) come from
 * `AppConfig.contextRoots` (`PROJECT_CONTEXT_ROOTS`), not from here — they are
 * an env-level knob, not a module literal. Everything below is a fixed bound
 * the spec pins to a number.
 */

/** Directory listing stops here; `ContextListing.total`/`.truncated` carry the rest. */
export const MAX_CONTEXT_FILES = 2000;

/**
 * Bytes read per attached document — both the single-doc preview
 * (`GET /repos/:id/context/doc`) and the run path. A document over this limit
 * reads as "missing" from the caller's point of view (never partially read).
 */
export const MAX_CONTEXT_DOC_BYTES = 20_000;

/** Total characters across every doc packed into the `## Project context` prompt block. */
export const MAX_CONTEXT_BLOCK_CHARS = 32_000;

/**
 * Directories the walk never enters, anywhere in the tree. Without this a
 * repository that vendors its dependencies (`node_modules` committed, or
 * present in the working tree) exhausts `MAX_CONTEXT_FILES` on someone else's
 * markdown before a single real doc is counted.
 */
export const SKIP_DIR_NAMES: ReadonlySet<string> = new Set(['node_modules', '.git', 'dist', '.next']);

/** `AppError.code` for "this repo has never been cloned" (409) — mirrors `conventions`' `REPO_NOT_CLONED_CODE`. */
export const REPO_NOT_CLONED_CODE = 'repo_not_cloned';

/**
 * Deterministic size-based token estimate (~4 bytes/token — a common rough
 * ratio for English + code). NOT a real tokenizer count: the NFR forbids the
 * listing walk from reading file content, and a tokenizer without text to feed
 * it cannot produce one. One shared estimate (`estimateTokens` in helpers.ts)
 * backs the page footer, the tab badge, and the run's Live Log line so the
 * three numbers never disagree.
 */
export const BYTES_PER_TOKEN_EST = 4;
