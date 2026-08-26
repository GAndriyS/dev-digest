import { z } from 'zod';

/**
 * Pure, DB-free helpers for the eval scorer (AC-15). No I/O, no imports from
 * `platform/`, `adapters/` or the DI container — everything here is a plain
 * function over plain data, unit-testable without a database or a model call.
 */

// ---- Expected findings ------------------------------------------------

/**
 * One expected finding, as read out of an eval case's `expected_output`
 * jsonb. The scorer matches ONLY on `file` + line range (AC-15) — `severity`,
 * `category` and `title` are accepted (they are what `POST
 * /findings/:id/eval-case` writes, per AC-3) but never read for matching.
 * `.passthrough()` so unrecognised extra keys do not fail validation.
 */
export const ExpectedFinding = z
  .object({
    file: z.string(),
    start_line: z.number().int(),
    end_line: z.number().int(),
    severity: z.string().optional(),
    category: z.string().optional(),
    title: z.string().optional(),
  })
  .passthrough();
export type ExpectedFinding = z.infer<typeof ExpectedFinding>;

/** The shape an eval case's `expected_output` must have to be scoreable. */
export const ExpectedEvalOutput = z.object({ findings: z.array(ExpectedFinding) });
export type ExpectedEvalOutput = z.infer<typeof ExpectedEvalOutput>;

/**
 * Read the expected findings out of an eval case's untyped `expected_output`
 * jsonb. A blob that does not match the contract — missing, `null`, or a
 * shape the scorer does not understand — yields `[]` rather than throwing:
 * a malformed fixture fails its OWN case (as "expected nothing", scored via
 * AC-16/AC-20) instead of 500ing the run endpoint. Mirrors
 * `skills/helpers.ts:137-140`.
 */
export function expectedFindings(expectedOutput: unknown): ExpectedFinding[] {
  const parsed = ExpectedEvalOutput.safeParse(expectedOutput);
  return parsed.success ? parsed.data.findings : [];
}

// ---- File path / line range -------------------------------------------

/**
 * Normalize a file path for comparison: unify path separators, drop a
 * leading `./`, and strip leading slashes — so `./src/a.ts`, `src/a.ts` and
 * `/src/a.ts` are treated as the same file. Case is preserved; this repo's
 * filesystems (and git) are case-sensitive.
 */
export function normalizeFilePath(file: string): string {
  return file
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');
}

/** A line range, inclusive on both ends (matches `Finding.start_line/end_line`). */
export interface LineRange {
  start_line: number;
  end_line: number;
}

/** True iff two inclusive line ranges share at least one line. */
export function rangesOverlap(a: LineRange, b: LineRange): boolean {
  return a.start_line <= b.end_line && b.start_line <= a.end_line;
}
