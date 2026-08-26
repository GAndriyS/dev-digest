import { describe, it, expect } from 'vitest';
import {
  citationAccuracy,
  evalPass,
  matchFindings,
  precision,
  recall,
  scoreEvalCase,
  type ActualFinding,
} from '../src/modules/eval/scoring.js';
import {
  expectedFindings,
  normalizeFilePath,
  rangesOverlap,
  type ExpectedFinding,
} from '../src/modules/eval/helpers.js';
import { BATCH_TABLE_LIMIT, REGRESSION_THRESHOLD_PP } from '../src/modules/eval/constants.js';

/**
 * Hermetic unit tests for the eval scorer (AC-15..AC-21, AC-31). Pure
 * functions, no database, no model call.
 */

function expected(over: Partial<ExpectedFinding> = {}): ExpectedFinding {
  return { file: 'src/config.ts', start_line: 10, end_line: 12, ...over };
}

function actual(over: Partial<ActualFinding> = {}): ActualFinding {
  return { file: 'src/config.ts', start_line: 10, end_line: 12, ...over };
}

describe('normalizeFilePath / rangesOverlap', () => {
  it('treats ./path, /path and path as the same file', () => {
    expect(normalizeFilePath('./src/a.ts')).toBe('src/a.ts');
    expect(normalizeFilePath('/src/a.ts')).toBe('src/a.ts');
    expect(normalizeFilePath('src/a.ts')).toBe('src/a.ts');
  });

  it('overlaps when ranges share at least one line, including a shared endpoint', () => {
    expect(rangesOverlap({ start_line: 10, end_line: 12 }, { start_line: 11, end_line: 20 })).toBe(true);
    expect(rangesOverlap({ start_line: 10, end_line: 12 }, { start_line: 12, end_line: 12 })).toBe(true);
    expect(rangesOverlap({ start_line: 10, end_line: 12 }, { start_line: 13, end_line: 20 })).toBe(false);
  });
});

describe('matchFindings — AC-15 credit assignment', () => {
  it('credits a match on same normalized path + overlapping range', () => {
    const { creditedExpectations, creditedActuals } = matchFindings([expected()], [actual()]);
    expect(creditedExpectations).toBe(1);
    expect(creditedActuals).toBe(1);
  });

  it('does NOT credit an overlapping range in a different file', () => {
    const r = matchFindings([expected({ file: 'src/config.ts' })], [actual({ file: 'src/other.ts' })]);
    expect(r).toEqual({ creditedExpectations: 0, creditedActuals: 0 });
  });

  it('does NOT credit the same file with a non-overlapping range', () => {
    const r = matchFindings(
      [expected({ start_line: 10, end_line: 12 })],
      [actual({ start_line: 50, end_line: 55 })],
    );
    expect(r).toEqual({ creditedExpectations: 0, creditedActuals: 0 });
  });

  it('MANDATORY NEGATIVE: a finding with the same title in a DIFFERENT file is not counted', () => {
    const exp = expected({ file: 'src/config.ts', title: 'hardcoded secret' } as ExpectedFinding);
    const act = actual({ file: 'src/unrelated.ts' });
    const r = matchFindings([exp], [act]);
    expect(r).toEqual({ creditedExpectations: 0, creditedActuals: 0 });
  });

  it('never credits the same actual finding twice, even against two matching expectations', () => {
    const exp = [expected(), expected()];
    const act = [actual()];
    const r = matchFindings(exp, act);
    expect(r).toEqual({ creditedExpectations: 1, creditedActuals: 1 });
  });

  it('credits each actual at most once when multiple actuals overlap the same expectation', () => {
    const exp = [expected()];
    const act = [actual(), actual({ start_line: 11, end_line: 11 })];
    const r = matchFindings(exp, act);
    expect(r).toEqual({ creditedExpectations: 1, creditedActuals: 1 });
  });

  it('ignores severity and category — AC-15 matches on file + line range only', () => {
    const exp = expected({ severity: 'CRITICAL', category: 'security' } as ExpectedFinding);
    const act = actual();
    // no severity/category on ActualFinding at all — matching must not need them
    expect(matchFindings([exp], [act]).creditedExpectations).toBe(1);
  });
});

describe('recall / precision / citationAccuracy / evalPass — zero-denominator rules', () => {
  it('recall is 1 when there are no expectations', () => {
    expect(recall(0, 0)).toBe(1);
  });

  it('recall is the credited fraction otherwise', () => {
    expect(recall(4, 3)).toBe(0.75);
  });

  it('precision is 1 when nothing survived grounding', () => {
    expect(precision(0, 0)).toBe(1);
  });

  it('precision is the credited fraction of survivors otherwise', () => {
    expect(precision(1, 2)).toBe(0.5);
  });

  it('citation_accuracy is 1 when the model emitted nothing', () => {
    expect(citationAccuracy(0, 0)).toBe(1);
  });

  it('citation_accuracy is survived / raw otherwise', () => {
    expect(citationAccuracy(3, 4)).toBe(0.75);
    expect(citationAccuracy(0, 2)).toBe(0);
  });

  it('pass iff recall = 1 AND precision = 1', () => {
    expect(evalPass(1, 1)).toBe(true);
    expect(evalPass(1, 0.5)).toBe(false);
    expect(evalPass(0.5, 1)).toBe(false);
    expect(evalPass(0, 0)).toBe(false);
  });
});

describe('scoreEvalCase — end to end', () => {
  it('a must_find case with a correct, grounded finding passes 1/1/1', () => {
    const score = scoreEvalCase([expected()], [actual()], 1);
    expect(score).toEqual({ pass: true, recall: 1, precision: 1, citation_accuracy: 1 });
  });

  it('a must_find case where the model finds nothing: recall 0, precision 1 (nothing survived), fails', () => {
    const score = scoreEvalCase([expected()], [], 0);
    expect(score).toEqual({ pass: false, recall: 0, precision: 1, citation_accuracy: 1 });
  });

  it('AC-20: expected [] and the agent emits a finding → precision 0, case fails', () => {
    const score = scoreEvalCase([], [actual()], 1);
    expect(score.recall).toBe(1);
    expect(score.precision).toBe(0);
    expect(score.pass).toBe(false);
  });

  it('AC-4/must_not_flag with a clean diff: expected [] and nothing survived → recall 1, precision 1, passes', () => {
    const score = scoreEvalCase([], [], 0);
    expect(score).toEqual({ pass: true, recall: 1, precision: 1, citation_accuracy: 1 });
  });

  it('edge: the model emitted findings but grounding killed all of them on a must_find case — ' +
    'citation_accuracy 0, precision computed over zero survivors (= 1), case fails via recall',
  () => {
    // rawCount 2 (the model emitted two findings), 0 survived the gate.
    const score = scoreEvalCase([expected()], [], 2);
    expect(score.citation_accuracy).toBe(0);
    expect(score.precision).toBe(1);
    expect(score.recall).toBe(0);
    expect(score.pass).toBe(false);
  });
});

describe('expectedFindings — safeParse over the untyped jsonb blob', () => {
  it('reads a well-formed expected_output', () => {
    const out = expectedFindings({ findings: [{ file: 'a.ts', start_line: 1, end_line: 2 }] });
    expect(out).toEqual([{ file: 'a.ts', start_line: 1, end_line: 2 }]);
  });

  it('treats absent/null/malformed expected_output as "expected nothing" ([]) — never throws', () => {
    expect(expectedFindings(null)).toEqual([]);
    expect(expectedFindings(undefined)).toEqual([]);
    expect(expectedFindings('nope')).toEqual([]);
    expect(expectedFindings({ findings: [{ file: 'a.ts' }] })).toEqual([]); // missing lines
    expect(expectedFindings({ findings: 'not-an-array' })).toEqual([]);
  });

  it('accepts the full shape POST /findings/:id/eval-case writes (AC-3) without dropping extra keys', () => {
    const out = expectedFindings({
      findings: [
        {
          file: 'src/config.ts',
          start_line: 10,
          end_line: 12,
          severity: 'CRITICAL',
          category: 'security',
          title: 'hardcoded secret',
        },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ file: 'src/config.ts', start_line: 10, end_line: 12 });
  });

  it('an empty findings array parses as must_not_flag, not as malformed', () => {
    expect(expectedFindings({ findings: [] })).toEqual([]);
  });
});

describe('module constants', () => {
  it('REGRESSION_THRESHOLD_PP is 2 percentage points', () => {
    expect(REGRESSION_THRESHOLD_PP).toBe(2);
  });

  it('BATCH_TABLE_LIMIT caps the recent-batches table at 20', () => {
    expect(BATCH_TABLE_LIMIT).toBe(20);
  });
});
