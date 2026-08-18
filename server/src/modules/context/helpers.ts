import { BYTES_PER_TOKEN_EST } from './constants.js';
import type { SkippedContextDoc } from './types.js';

/**
 * Deterministic size-based token estimate (see `constants.ts` for why this is
 * not a real tokenizer count). Rounds up so a non-empty file never reads as
 * "0 tokens", and floors at 1 for the same reason.
 */
export function estimateTokens(bytes: number): number {
  return Math.max(1, Math.ceil(bytes / BYTES_PER_TOKEN_EST));
}

/**
 * The configured root name a listed path was found under — the FIRST path
 * segment that matches a configured root, scanning left to right. Returns
 * `null` for a path that isn't under any configured root (can happen for an
 * attached path read back outside the listing walk, e.g. a legacy attachment
 * whose repo layout changed) — callers treat that as "no badge", not an error.
 */
export function rootBadgeFor(relPath: string, roots: readonly string[]): string | null {
  const rootSet = new Set(roots);
  for (const segment of relPath.split('/')) {
    if (rootSet.has(segment)) return segment;
  }
  return null;
}

/**
 * Keep the FIRST occurrence of each path, in original order. This is the
 * merge rule for "an agent's own attachments + everything inherited from its
 * enabled skills" (SPEC-01 AC-17/AC-18): the agent's own choice always wins
 * over an inherited duplicate, and the first skill in prompt order wins over
 * a later one.
 */
export function dedupeKeepFirst(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

/**
 * One document, formatted for the `specs` prompt slot. reviewer-core wraps
 * each array element with `wrapUntrusted('spec-N', …)` — it has no idea which
 * document N is, so the path is baked into the chunk itself (matches the
 * `## <file>` framing `run-executor`'s callers/repo-map digests already use).
 */
export function formatContextChunk(path: string, content: string): string {
  return `### ${path}\n\n${content}`;
}

/** Result of packing already-read documents under a character budget. */
export interface PackedContextDocs {
  specs: string[];
  specsRead: string[];
  skipped: SkippedContextDoc[];
}

/**
 * Pack already-read documents into the prompt block, stopping (per-document)
 * once the running total would exceed `maxChars`. A document that doesn't fit
 * is skipped, not truncated — a partial markdown doc is worse than no doc,
 * and the Live Log line + `specs_read` gap make the drop visible (Observability
 * NFR, `server/INSIGHTS.md`-precedent "never go silent").
 *
 * Pure — no I/O. The service reads file content first; this only decides
 * ordering and the budget cutoff, which is what makes it unit-testable
 * without a filesystem or a container.
 */
export function packDocs(
  docs: readonly { path: string; content: string }[],
  maxChars: number,
): PackedContextDocs {
  const specs: string[] = [];
  const specsRead: string[] = [];
  const skipped: SkippedContextDoc[] = [];
  let total = 0;
  for (const { path, content } of docs) {
    const chunk = formatContextChunk(path, content);
    if (total + chunk.length > maxChars) {
      skipped.push({ path, reason: `exceeds the ${maxChars}-character project context budget` });
      continue;
    }
    specs.push(chunk);
    specsRead.push(path);
    total += chunk.length;
  }
  return { specs, specsRead, skipped };
}
