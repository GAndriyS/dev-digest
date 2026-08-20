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

/**
 * Most `context_doc` entries `inputs[]` lists INDIVIDUALLY with status
 * `unavailable` (dropped by the count/char budget or an unreadable doc) — a
 * separate bound from `MAX_BRIEF_CONTEXT_DOCS` (docs actually read). Without
 * this, `relevantContextDocs` matching hundreds of documents (any repo with
 * AGENTS.md/INSIGHTS.md/README.md scattered through `src/`) would push one
 * `inputs[]` entry per match, making the persisted `pr_brief.json` row, the
 * `GET /pulls/:id/brief` response and the generation log line all unbounded
 * (code review fix pass 1, item 3). Anything beyond this bound collapses
 * into ONE rollup entry — see `facts.ts`'s Project Context section.
 */
export const MAX_BRIEF_CONTEXT_DOC_DROPPED_INPUTS = 12;

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
