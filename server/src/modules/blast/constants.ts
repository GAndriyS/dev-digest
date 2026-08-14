/**
 * blast module (L04) — public surface. Only `constants.ts` / `types.ts` /
 * `index.ts` may be imported by another module.
 */

import { z } from 'zod';

/** Model budget for the opt-in paragraph. One short paragraph, nothing more. */
export const BLAST_SUMMARY_MAX_TOKENS = 400;

/** Reprompt-on-schema-error budget, mirroring the intent classifier's spirit. */
export const BLAST_SUMMARY_MAX_RETRIES = 2;

/**
 * Structured output for the paragraph. The workspace's default provider is
 * OpenRouter, whose adapter implements ONLY `completeStructured` — a plain
 * `complete()` call throws (`reviewer-core/src/llm/openrouter.ts:25`), so the
 * summary goes through the structured path like every other model call here.
 */
export const BlastSummaryOutput = z.object({
  summary: z.string().min(1),
});
export type BlastSummaryOutput = z.infer<typeof BlastSummaryOutput>;

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
