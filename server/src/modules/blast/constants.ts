/**
 * blast module (L04) — public surface. Only `constants.ts` / `types.ts` /
 * `index.ts` may be imported by another module.
 */

/** Model budget for the opt-in paragraph. One short paragraph, nothing more. */
export const BLAST_SUMMARY_MAX_TOKENS = 400;

/** The map is facts; the model only narrates it. */
export const BLAST_SUMMARY_SYSTEM_PROMPT = [
  'You explain the blast radius of a pull request to a code reviewer.',
  'You are given a precomputed impact map: symbols declared in the changed files,',
  'the callers that reference them, and the HTTP endpoints and cron jobs that',
  'depend on that code. Every node and edge in it was derived from a static index.',
  '',
  'Write ONE short paragraph (3-5 sentences, plain prose, no lists, no headings)',
  'telling the reviewer what else this change can affect and where to look first.',
  'Lead with the widest-reaching symbol. Name real files, symbols and endpoints',
  'from the map only — never invent a caller, an endpoint or a file, and never',
  'claim an impact the map does not show. If the map is empty or degraded, say',
  'plainly that the index could not establish downstream impact.',
].join('\n');
