/**
 * PR Why + Risk Brief (L05/SPEC-04) — module constants.
 */

/** `risks[]` cap after server-side grounding (Open question 1). */
export const MAX_BRIEF_RISKS = 5;

/** `review_focus[]` cap after server-side grounding (Open question 1). */
export const MAX_BRIEF_REVIEW_FOCUS = 5;

/**
 * How many relevant Project Context documents are read per generation
 * (AC-12). Oriented on `context/constants.ts`'s `MAX_CONTEXT_FILES`/
 * `MAX_CONTEXT_BLOCK_CHARS` but scaled DOWN: this prompt is a short brief,
 * not a full review, so it needs evidence, not the whole doc set. A doc
 * dropped by this cap still shows in `inputs` as `unavailable` (AC-12).
 */
export const MAX_BRIEF_CONTEXT_DOCS = 8;

/** Total characters across every Project Context doc packed into the prompt (AC-12). */
export const MAX_BRIEF_CONTEXT_CHARS = 20_000;

/**
 * Total characters of the assembled facts block (intent + blast + diff stats
 * + linked issue), clipped AFTER assembly — same "build then clip once"
 * strategy as `onboarding/helpers.ts`'s `MAX_PROMPT_TOTAL_CHARS`, so a PR with
 * hundreds of changed files still produces a bounded prompt (NFR-2, EC-7).
 */
export const MAX_BRIEF_FACTS_CHARS = 40_000;

/** `completeStructured`'s reprompt-on-error budget; `attempts` never exceeds this + 1. */
export const MAX_STRUCTURED_RETRIES = 2;

/** Names the JSON schema in the provider request (mock adapter fixture key). */
export const SCHEMA_NAME = 'PrWhyBrief';

/** Mirrors onboarding/conventions/skills — the UI keys its disabled action off this. */
export { NO_PROVIDER_KEY_CODE } from '../../platform/errors.js';
