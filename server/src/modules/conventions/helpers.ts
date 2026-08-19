import { clipHead } from '../_shared/prompt-text.js';
import { z } from 'zod';
import type { ChatMessage, ConventionCandidate } from '@devdigest/shared';
import type { ConventionRow } from './repository.js';
import {
  DEFAULT_CATEGORY,
  MAX_CANDIDATES,
  MAX_CATEGORY_CHARS,
  MAX_FILE_CHARS,
  MIN_SNIPPET_CHARS,
} from './constants.js';

/**
 * L03 — pure helpers for the conventions extractor. No I/O, no container: the
 * evidence gate is the part most worth testing, so it is kept callable with
 * plain strings.
 */

/**
 * What the model is asked to return. Deliberately NOT `ConventionCandidate`:
 * `id` and `status` are the server's to assign, and `evidence_line` is derived
 * from the file rather than trusted from the model. Asking for fewer fields
 * also means fewer ways for a strict-schema call to fail.
 */
export const ExtractedConvention = z.object({
  category: z.string(),
  rule: z.string(),
  evidence_path: z.string(),
  evidence_snippet: z.string(),
  confidence: z.number().min(0).max(1),
});
export type ExtractedConvention = z.infer<typeof ExtractedConvention>;

export const ConventionExtraction = z.object({
  conventions: z.array(ExtractedConvention),
});
export type ConventionExtraction = z.infer<typeof ConventionExtraction>;

export interface SampleFile {
  path: string;
  content: string;
}

/** Truncate to the head — conventions show up in imports and the first handler. */
export function clipFile(content: string): string {
  return clipHead(content, MAX_FILE_CHARS);
}

/**
 * One user message listing every sampled file with its path. Paths are repeated
 * verbatim in the fences because `evidence_path` has to match one of them
 * exactly for the candidate to survive verification.
 */
export function buildExtractionMessages(files: SampleFile[], systemPrompt: string): ChatMessage[] {
  const excerpts = files
    .map((f) => `### ${f.path}\n\`\`\`\n${clipFile(f.content)}\n\`\`\``)
    .join('\n\n');
  return [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content:
        `Here are ${files.length} excerpts from one repository. ` +
        `Report at most ${MAX_CANDIDATES} conventions this repo consistently follows.\n\n` +
        `${excerpts}`,
    },
  ];
}

/**
 * Collapse a line to its comparable form: inner whitespace runs become one
 * space, edges are trimmed. Indentation and alignment are exactly the details a
 * model reformats when it copies, and none of them change what the code says.
 */
function normalizeLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

/**
 * Find where `snippet` occurs in `content` and return its 1-based start line, or
 * `null` when it does not occur.
 *
 * Matching is per line and by containment rather than equality: a model that
 * copies `return ok(items);` out of `  return ok(items); // fast path` has still
 * pointed at real code, and demanding the whole line back would throw away true
 * evidence. What containment will not do is invent — every snippet line must
 * appear, in order, in consecutive NON-BLANK lines of the file.
 *
 * Blank lines are dropped from BOTH sides, and the file's real line numbers are
 * carried alongside so the located line stays true. Dropping them on the snippet
 * side only was worse than it looked: a snippet copied character-for-character
 * across a blank line — exactly what the system prompt demands — could never
 * match, and the honest rule was then counted in `dropped_no_evidence`, the
 * field the UI presents as the measure of what the model made up.
 *
 * The line number matters as much as the boolean: it is what the UI deep-links
 * to on GitHub, and the model's own count is not reliable enough to publish.
 */
export function locateSnippet(content: string, snippet: string): number | null {
  const fileLines: { text: string; lineNo: number }[] = [];
  content.split(/\r?\n/).forEach((raw, i) => {
    const text = normalizeLine(raw);
    if (text.length > 0) fileLines.push({ text, lineNo: i + 1 });
  });
  const needle = snippet
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter((l) => l.length > 0);
  if (needle.length === 0) return null;
  // Reject evidence too short to identify anything. `}` or `const` matches in
  // almost any file, so accepting it would let an invented rule pass the gate
  // wearing a fragment that points nowhere in particular.
  if (needle.join(' ').length < MIN_SNIPPET_CHARS) return null;

  for (let i = 0; i + needle.length <= fileLines.length; i++) {
    let hit = true;
    for (let j = 0; j < needle.length; j++) {
      if (!fileLines[i + j]!.text.includes(needle[j]!)) {
        hit = false;
        break;
      }
    }
    if (hit) return fileLines[i]!.lineNo;
  }
  return null;
}

/**
 * Snap the model's `category` to the one short word the contract publishes.
 *
 * The prompt asks for a single lowercase grouping word, but a prompt is a
 * request: a model that answers with a sentence would put that sentence in the
 * UI's badge and break a bound the contract states as fact. The FIRST token is
 * kept rather than the whole string truncated — half a sentence is not a
 * category either — and anything that survives as empty or over-long falls back
 * to `general` instead of being stored as something no reader can group by.
 */
export function normalizeCategory(raw: string): string {
  const [word = ''] = raw
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((t) => t.length > 0);
  return word.length > 0 && word.length <= MAX_CATEGORY_CHARS ? word : DEFAULT_CATEGORY;
}

/** Rules that differ only in casing, spacing or trailing punctuation are one rule. */
export function normalizeRule(rule: string): string {
  return rule
    .toLowerCase()
    .replace(/[.\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface VerifiedConvention extends ExtractedConvention {
  evidence_line: number;
}

export interface VerificationOutcome {
  kept: VerifiedConvention[];
  /** Snippet could not be located, or named a file that was never sampled. */
  droppedNoEvidence: number;
  /** Perfectly grounded, but restates a rule already stored for this repo. */
  droppedDuplicate: number;
}

/**
 * The evidence gate. A candidate survives only when the file it names was
 * actually sampled AND its snippet can be located in that file; the located
 * line replaces whatever the model may have thought.
 *
 * Duplicates are dropped against `existingRules` (rules already stored for this
 * repo, including ones the user rejected) and against each other, so a re-scan
 * does not resurrect a rejected rule under a slightly different wording.
 *
 * The two reasons for dropping are counted separately and must stay that way:
 * only the evidence failures say anything about whether the model invented
 * something. A re-scan that correctly re-proposes known rules would otherwise
 * report as a scan full of fabrications.
 */
export function verifyCandidates(
  candidates: ExtractedConvention[],
  files: SampleFile[],
  existingRules: string[] = [],
): VerificationOutcome {
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  const seen = new Set(existingRules.map(normalizeRule));
  const kept: VerifiedConvention[] = [];
  let droppedNoEvidence = 0;
  let droppedDuplicate = 0;

  for (const c of candidates) {
    const content = byPath.get(c.evidence_path);
    if (content === undefined) {
      droppedNoEvidence++;
      continue;
    }
    const line = locateSnippet(content, c.evidence_snippet);
    if (line === null) {
      droppedNoEvidence++;
      continue;
    }
    const key = normalizeRule(c.rule);
    if (key.length === 0 || seen.has(key)) {
      droppedDuplicate++;
      continue;
    }
    seen.add(key);
    kept.push({ ...c, evidence_line: line });
  }
  return { kept, droppedNoEvidence, droppedDuplicate };
}

/** Row → wire DTO. Nullable evidence columns are pre-existing; default them. */
export function toConventionDto(row: ConventionRow): ConventionCandidate {
  return {
    id: row.id,
    category: row.category,
    rule: row.rule,
    evidence_path: row.evidencePath ?? '',
    evidence_snippet: row.evidenceSnippet ?? '',
    evidence_line: row.evidenceLine,
    confidence: row.confidence ?? 0,
    status: row.status,
  };
}
