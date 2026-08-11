import { describe, expect, it } from 'vitest';
import {
  aggregateFindings,
  countSeverities,
  formatLines,
  sortFindings,
  toFindingSummary,
  truncateText,
  truncateToCharacterLimit,
  worstVerdict,
} from '../../src/lib/shape.js';
import { makeFinding, makeReview } from '../helpers/fixtures.js';

describe('truncateText', () => {
  it('passes short strings through unchanged', () => {
    expect(truncateText('short', 500)).toBe('short');
  });

  it('truncates to max chars with an ellipsis', () => {
    const result = truncateText('a'.repeat(510), 500);
    expect(result.length).toBe(500);
    expect(result.endsWith('…')).toBe(true);
  });
});

describe('formatLines', () => {
  it('renders a single number when start equals end', () => {
    expect(formatLines(10, 10)).toBe('10');
  });

  it('renders a range otherwise', () => {
    expect(formatLines(10, 18)).toBe('10-18');
  });
});

describe('aggregateFindings', () => {
  it('excludes dismissed findings and keeps every review (decision 2)', () => {
    const reviews = [
      makeReview({
        agent_name: 'A',
        findings: [makeFinding({ id: 'f1' }), makeFinding({ id: 'f2', dismissed_at: '2026-01-01' })],
      }),
      makeReview({ agent_name: 'B', findings: [makeFinding({ id: 'f3' })] }),
    ];

    const out = aggregateFindings(reviews);
    expect(out.map((o) => o.finding.id)).toEqual(['f1', 'f3']);
    expect(out.map((o) => o.agent)).toEqual(['A', 'B']);
  });
});

describe('sortFindings', () => {
  it('sorts severity desc, then confidence desc, then file asc', () => {
    const items = [
      { finding: makeFinding({ severity: 'SUGGESTION', confidence: 0.9, file: 'b.ts' }) },
      { finding: makeFinding({ severity: 'CRITICAL', confidence: 0.5, file: 'z.ts' }) },
      { finding: makeFinding({ severity: 'CRITICAL', confidence: 0.9, file: 'a.ts' }) },
    ];
    const sorted = sortFindings(items);
    expect(sorted.map((s) => s.finding.file)).toEqual(['a.ts', 'z.ts', 'b.ts']);
  });
});

describe('countSeverities', () => {
  it('tallies each severity independently', () => {
    const counts = countSeverities([
      makeFinding({ severity: 'CRITICAL' }),
      makeFinding({ severity: 'CRITICAL' }),
      makeFinding({ severity: 'WARNING' }),
      makeFinding({ severity: 'SUGGESTION' }),
    ]);
    expect(counts).toEqual({ critical: 2, warning: 1, suggestion: 1 });
  });
});

describe('worstVerdict', () => {
  it('picks request_changes over comment and approve', () => {
    expect(worstVerdict(['approve', 'comment', 'request_changes'])).toBe('request_changes');
  });

  it('picks comment over approve', () => {
    expect(worstVerdict(['approve', 'comment'])).toBe('comment');
  });

  it('returns null when every verdict is null', () => {
    expect(worstVerdict([null, null])).toBeNull();
  });
});

describe('toFindingSummary', () => {
  it('truncates rationale/suggestion and drops persisted-row fields', () => {
    const finding = makeFinding({
      rationale: 'x'.repeat(600),
      suggestion: 'y'.repeat(600),
    });
    const summary = toFindingSummary(finding, 'Reviewer');
    expect(summary.rationale.length).toBe(500);
    expect(summary.suggestion!.length).toBe(500);
    expect(summary).not.toHaveProperty('id');
    expect(summary).not.toHaveProperty('review_id');
  });
});

describe('truncateToCharacterLimit', () => {
  it('keeps everything under the limit', () => {
    const { items, truncated } = truncateToCharacterLimit([{ a: 1 }, { a: 2 }], 1000);
    expect(items).toHaveLength(2);
    expect(truncated).toBe(false);
  });

  it('drops items from the tail once the limit is hit, but always keeps the first item', () => {
    const big = { text: 'x'.repeat(100) };
    const { items, truncated } = truncateToCharacterLimit([big, big, big], 150);
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items.length).toBeLessThan(3);
    expect(truncated).toBe(true);
  });
});
