import { z } from 'zod';
import { FindingCategory, Severity } from '@devdigest/shared';
import type {
  EvalCase,
  EvalOwnerKind,
  Finding,
  Skill,
  SkillSource,
  SkillType,
  SkillVersion,
} from '@devdigest/shared';
import type { EvalCaseRow, SkillRow, SkillVersionRow } from './repository.js';

/**
 * Pure helpers for the skills module — DB row ⇄ DTO mapping, the version-bump
 * rule, and the eval comparator. No I/O, so every rule below is unit-testable
 * without a database or a model call.
 */

// ---- DTO mapping ----------------------------------------------------------

export function toSkillDto(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as SkillType,
    source: row.source as SkillSource,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: row.evidenceFiles ?? null,
  };
}

/**
 * Map a `skill_versions` row to the public DTO. `body` is omitted from LIST
 * responses (`withBody: false`) — a history page renders sizes and dates, and
 * shipping every historical body would make the payload grow without bound.
 * `body_chars` is always present so the list can show how much changed.
 */
export function toSkillVersionDto(row: SkillVersionRow, withBody: boolean): SkillVersion {
  return {
    skill_id: row.skillId,
    version: row.version,
    ...(withBody ? { body: row.body } : {}),
    body_chars: row.body.length,
    created_at: row.createdAt.toISOString(),
  };
}

/**
 * The version entry for a skill that has never been edited.
 *
 * `skill_versions` is written only when a body CHANGES, so a fresh skill sits at
 * `version = 1` with zero history rows. Rather than backfill a row on create
 * (which would make "a version row exists" mean two different things), the read
 * path synthesizes the current version from the skill itself. The first edit
 * persists this exact entry — see `SkillsRepository.update`.
 */
export function currentVersionEntry(skill: SkillRow, withBody: boolean): SkillVersion {
  return {
    skill_id: skill.id,
    version: skill.version,
    ...(withBody ? { body: skill.body } : {}),
    body_chars: skill.body.length,
    created_at: skill.createdAt.toISOString(),
  };
}

export function toEvalCaseDto(row: EvalCaseRow): EvalCase {
  return {
    id: row.id,
    owner_kind: row.ownerKind as EvalOwnerKind,
    owner_id: row.ownerId,
    name: row.name,
    input_diff: row.inputDiff ?? '',
    input_files: row.inputFiles ?? null,
    input_meta: row.inputMeta ?? null,
    expected_output: row.expectedOutput ?? null,
    notes: row.notes,
    expectation_kind: row.expectationKind ?? null,
  };
}

// ---- Versioning rule ------------------------------------------------------

/** The subset of a skill patch that the version rule looks at. */
export interface SkillVersionPatch {
  body?: string | undefined;
}

/**
 * The version-bump rule, stated once.
 *
 * A skill's `body` is what actually reaches the model, so a changed body mints a
 * NEW immutable version (the UI copy promises exactly that). Metadata-only edits
 * — rename, description, type, enabled, evidence files — leave the version
 * alone, so renaming a skill does not invalidate an eval run that scored its
 * text, nor orphan the `run_skills.skill_version` recorded by past runs.
 *
 * Re-saving the identical body is not a change: it must not mint a duplicate.
 */
export function nextSkillVersion(
  existing: Pick<SkillRow, 'version' | 'body'>,
  patch: SkillVersionPatch,
): { version: number; bumped: boolean } {
  const bumped = patch.body !== undefined && patch.body !== existing.body;
  return { version: bumped ? existing.version + 1 : existing.version, bumped };
}

// ---- Eval comparator ------------------------------------------------------

/** One expected finding: severity is the gate, category is documentation. */
export const ExpectedFinding = z.object({
  severity: Severity,
  category: FindingCategory.optional(),
});

/** The shape an eval case's `expected_output` must have to be runnable. */
export const ExpectedEvalOutput = z.object({ findings: z.array(ExpectedFinding) });
export type ExpectedEvalOutput = z.infer<typeof ExpectedEvalOutput>;

export interface EvalComparison {
  pass: boolean;
  /** Size of the severity multiset intersection (the numerator of both ratios). */
  matched: number;
  recall: number;
  precision: number;
}

/**
 * Read the expected findings out of an eval case's untyped `expected_output`
 * jsonb. A blob that does not match the contract yields `[]` — "expected
 * nothing" — rather than throwing: a malformed fixture should fail its own case
 * loudly on the results page, not 500 the run endpoint.
 */
export function expectedFindings(expectedOutput: unknown): ExpectedEvalOutput['findings'] {
  const parsed = ExpectedEvalOutput.safeParse(expectedOutput);
  return parsed.success ? parsed.data.findings : [];
}

/**
 * THE PASS RULE (deliberately simple, and stated here so it is arguable):
 *
 *   pass ⟺ the produced findings have the SAME COUNT as the expected ones
 *           AND the same MULTISET of severities.
 *
 * That is the whole gate. Three things are deliberately NOT part of it:
 *
 * - **Category.** It is recorded in `actual` for the human reading the result,
 *   but models legitimately disagree on `bug` vs `security` for the same line;
 *   gating on it would measure taxonomy, not the skill.
 * - **Line numbers / titles.** Citation grounding already proved every surviving
 *   finding points at a real hunk, and asserting on prose is a flake factory.
 * - **Order.** Hence multiset, not list.
 *
 * `matched` is the size of the severity multiset intersection; `recall` and
 * `precision` are computed from it and default to 1 when their denominator is 0
 * (nothing expected → recall 1; nothing produced → precision 1), so a case that
 * expects nothing and produces nothing scores 1/1 and passes.
 */
export function compareEval(
  expected: { severity: string }[],
  actual: { severity: string }[],
): EvalComparison {
  const exp = expected.map((e) => e.severity).sort();
  const act = actual.map((a) => a.severity).sort();

  const pool = [...act];
  let matched = 0;
  for (const severity of exp) {
    const i = pool.indexOf(severity);
    if (i >= 0) {
      pool.splice(i, 1);
      matched += 1;
    }
  }

  const pass = exp.length === act.length && exp.every((s, i) => s === act[i]);
  return {
    pass,
    matched,
    recall: exp.length === 0 ? 1 : matched / exp.length,
    precision: act.length === 0 ? 1 : matched / act.length,
  };
}

/**
 * Fraction of the model's findings that survived citation grounding. 1 when the
 * model produced nothing at all — there was no citation to get wrong.
 */
export function citationAccuracy(kept: number, dropped: number): number {
  const total = kept + dropped;
  return total === 0 ? 1 : kept / total;
}

/** The slice of a produced finding that the eval result records and compares. */
export function toActualFinding(f: Finding): {
  severity: string;
  category: string;
  file: string;
  start_line: number;
  title: string;
} {
  return {
    severity: f.severity,
    category: f.category,
    file: f.file,
    start_line: f.start_line,
    title: f.title,
  };
}
