import { describe, it, expect } from 'vitest';
import {
  taskLine,
  flagOutOfScope,
  formatContextSummaryLine,
  formatContextAttachedLine,
  formatContextSkippedLine,
} from '../src/modules/reviews/helpers.js';
import type { Finding, Intent } from '@devdigest/shared';
import type { ContextDocSource } from '../src/modules/context/types.js';

/**
 * Unit coverage for the review task-line. The key invariant: our trusted
 * instruction always tells the model to review the whole diff and never
 * withhold a security/correctness finding — no matter what the PR text claims.
 */

describe('taskLine', () => {
  const pull = { number: 3, title: 'test: vulnerable fixture', author: 'burnjohn' } as never;

  it('names the PR being reviewed', () => {
    const line = taskLine(pull);
    expect(line).toContain('#3');
    expect(line).toContain('test: vulnerable fixture');
  });

  it('keeps the non-negotiable "never withhold security" rule', () => {
    const line = taskLine(pull);
    expect(line).toMatch(/never .*withhold .*(or downgrade )?.*security/i);
    expect(line).toMatch(/review the entire diff/i);
  });

  const intent: Intent = {
    intent: 'Adds rate limiting to public endpoints.',
    in_scope: ['src/api/ratelimit.ts'],
    out_of_scope: ['src/legacy/**'],
    risk_areas: ['auth bypass'],
    confidence: 0.8,
    sources: [],
  };

  it('is byte-identical to the no-intent line when intent is not passed (L03 must not change existing behaviour)', () => {
    expect(taskLine(pull, undefined)).toBe(taskLine(pull));
  });

  it('wraps the intent in an <untrusted source="pr-intent"> block, appended after the base instruction', () => {
    const withoutIntent = taskLine(pull);
    const withIntent = taskLine(pull, intent);

    // The base (trusted) instruction is preserved verbatim, never edited by
    // the presence of intent — intent is additive, not a replacement.
    expect(withIntent.startsWith(withoutIntent)).toBe(true);

    expect(withIntent).toContain('<untrusted source="pr-intent">');
    expect(withIntent).toContain('</untrusted>');
    // The intent's own fields appear as DATA inside the untrusted block, not
    // as new trusted instructions.
    expect(withIntent).toContain(intent.intent);
    expect(withIntent).toContain('src/api/ratelimit.ts');
    expect(withIntent).toContain('src/legacy/**');
    expect(withIntent).toContain('auth bypass');
  });
});

/**
 * SPEC-01 AC-37/AC-38/AC-41 — the three Project Context Live Log line shapes,
 * byte-for-byte. The two prefixes (`Project context: attached ` /
 * `Project context: skipped `) are asserted literally because
 * `test/reviews.it.test.ts:406` and the seed fixture already rely on them.
 */
describe('Project Context log-line formatters', () => {
  const AGENT: ContextDocSource = { kind: 'agent' };
  const VIA_SKILL: ContextDocSource = { kind: 'skill', skillId: 'sk1', skillName: 'pr-quality-rubric', skillVersion: 2 };

  describe('formatContextSummaryLine (AC-37)', () => {
    it('formats N attached / M skipped', () => {
      expect(formatContextSummaryLine(2, 1)).toBe('Project context: 2 doc(s) attached, 1 skipped');
    });

    it('formats the zero/zero case the same way — no special-casing (edge case, 19/08)', () => {
      expect(formatContextSummaryLine(0, 0)).toBe('Project context: 0 doc(s) attached, 0 skipped');
    });
  });

  describe('formatContextAttachedLine (AC-38)', () => {
    it('names the agent as the source right after the path', () => {
      expect(formatContextAttachedLine('specs/security.md', AGENT, 12)).toBe(
        'Project context: attached specs/security.md (agent, ~12 tokens)',
      );
    });

    it('names an inherited skill by name+version, matching the run\'s "Skills:" line vocabulary', () => {
      expect(formatContextAttachedLine('specs/security.md', VIA_SKILL, 12)).toBe(
        'Project context: attached specs/security.md (via skill pr-quality-rubric v2, ~12 tokens)',
      );
    });

    it('keeps the exact prefix `Project context: attached ` — existing tests and the seed fixture depend on it', () => {
      expect(formatContextAttachedLine('a.md', AGENT, 1).startsWith('Project context: attached ')).toBe(true);
    });
  });

  describe('formatContextSkippedLine (AC-41/AC-42)', () => {
    it('inserts the source before the reason, reason stays last', () => {
      expect(formatContextSkippedLine('specs/huge.md', AGENT, 'over the 40000-byte document limit')).toBe(
        'Project context: skipped specs/huge.md (agent) — over the 40000-byte document limit',
      );
    });

    it('AC-42: a skill lookup-failure pseudo-path still names the skill by name+version', () => {
      const line = formatContextSkippedLine(
        '(skill sk1 context)',
        VIA_SKILL,
        "could not load the skill's attached paths — timeout",
      );
      expect(line).toBe(
        "Project context: skipped (skill sk1 context) (via skill pr-quality-rubric v2) — could not load the skill's attached paths — timeout",
      );
    });

    it('keeps the exact prefix `Project context: skipped ` — existing tests and the seed fixture depend on it', () => {
      expect(formatContextSkippedLine('a.md', AGENT, 'reason').startsWith('Project context: skipped ')).toBe(true);
    });

    it('the reason stays last even when the reason itself contains a dash', () => {
      const line = formatContextSkippedLine('a.md', AGENT, 'over the 40,000-byte document limit — too large');
      expect(line.endsWith('over the 40,000-byte document limit — too large')).toBe(true);
      expect(line).toBe('Project context: skipped a.md (agent) — over the 40,000-byte document limit — too large');
    });
  });
});

/**
 * Unit coverage for the out-of-scope filter. This is the feature's whole
 * failure mode under test: a finding that is dropped without being reported
 * back to the caller is indistinguishable from a finding that silently
 * vanished — the "never go silent" precedent this helper exists to satisfy.
 */
describe('flagOutOfScope', () => {
  const baseFinding = (overrides: Partial<Finding> = {}): Finding => ({
    id: 'f-1',
    severity: 'CRITICAL',
    category: 'style',
    title: 'Finding',
    file: 'src/legacy/old.ts',
    start_line: 1,
    end_line: 1,
    rationale: 'Because.',
    confidence: 0.9,
    kind: 'finding',
    ...overrides,
  });

  const outOfScopeIntent: Intent = {
    intent: 'Refactors the public API.',
    in_scope: ['src/api/**'],
    out_of_scope: ['src/legacy/old.ts'],
    risk_areas: [],
    confidence: 0.9,
    sources: [],
  };

  it('no intent is a pass-through: findings are kept as-is and nothing is reported dropped', () => {
    const findings = [baseFinding()];
    const { kept, dropped } = flagOutOfScope(findings, undefined);
    expect(kept).toEqual(findings);
    expect(dropped).toEqual([]);
  });

  it('an empty out_of_scope is a pass-through: findings are kept as-is and nothing is reported dropped', () => {
    const findings = [baseFinding()];
    const emptyScopeIntent: Intent = { ...outOfScopeIntent, out_of_scope: [] };
    const { kept, dropped } = flagOutOfScope(findings, emptyScopeIntent);
    expect(kept).toEqual(findings);
    expect(dropped).toEqual([]);
  });

  it('out_of_scope entries that are blank/whitespace-only are treated as no scope claim at all', () => {
    // A raw empty string would `.includes()`-match every file in BOTH
    // directions, silently out-of-scoping (and under the drop rule, deleting)
    // every soft finding in the run.
    const findings = [baseFinding()];
    const blankScopeIntent: Intent = { ...outOfScopeIntent, out_of_scope: ['', '   '] };
    const { kept, dropped } = flagOutOfScope(findings, blankScopeIntent);
    expect(kept).toEqual(findings);
    expect(dropped).toEqual([]);
  });

  // The matrix: {in-scope, out-of-scope} x {CRITICAL soft, CRITICAL security,
  // CRITICAL bug, non-CRITICAL soft, non-CRITICAL protected}. Out of scope
  // DROPS a finding unless it is CRITICAL severity OR its category is
  // security/bug — either alone is enough to survive, marked in the
  // rationale as the surviving out-of-scope signal.
  it.each([
    {
      name: 'in-scope CRITICAL soft finding: untouched',
      file: 'src/api/handler.ts',
      severity: 'CRITICAL' as const,
      category: 'style' as const,
      expect: 'unchanged' as const,
    },
    {
      name: 'out-of-scope CRITICAL soft (style) finding: kept — CRITICAL severity alone protects it',
      file: 'src/legacy/old.ts',
      severity: 'CRITICAL' as const,
      category: 'style' as const,
      expect: 'kept' as const,
    },
    {
      name: 'out-of-scope CRITICAL security finding: kept — CRITICAL and security both protect it',
      file: 'src/legacy/old.ts',
      severity: 'CRITICAL' as const,
      category: 'security' as const,
      expect: 'kept' as const,
    },
    {
      name: 'out-of-scope CRITICAL bug finding: kept — CRITICAL and bug both protect it',
      file: 'src/legacy/old.ts',
      severity: 'CRITICAL' as const,
      category: 'bug' as const,
      expect: 'kept' as const,
    },
    {
      name: 'out-of-scope WARNING security finding: kept — category alone protects it',
      file: 'src/legacy/old.ts',
      severity: 'WARNING' as const,
      category: 'security' as const,
      expect: 'kept' as const,
    },
    {
      name: 'out-of-scope WARNING bug finding: kept — category alone protects it',
      file: 'src/legacy/old.ts',
      severity: 'WARNING' as const,
      category: 'bug' as const,
      expect: 'kept' as const,
    },
    {
      name: 'out-of-scope non-CRITICAL (WARNING) soft finding: DROPPED — neither condition holds',
      file: 'src/legacy/old.ts',
      severity: 'WARNING' as const,
      category: 'style' as const,
      expect: 'dropped' as const,
    },
  ])('$name', ({ file, severity, category, expect: outcome }) => {
    const finding = baseFinding({ file, severity, category });
    const { kept, dropped } = flagOutOfScope([finding], outOfScopeIntent);

    if (outcome === 'unchanged') {
      expect(kept).toEqual([finding]);
      expect(dropped).toHaveLength(0);
    } else if (outcome === 'kept') {
      expect(kept).toHaveLength(1);
      expect(kept[0]!.severity).toBe(severity);
      expect(kept[0]!.rationale).toContain('kept despite');
      expect(dropped).toHaveLength(0);
    } else {
      expect(kept).toHaveLength(0);
      expect(dropped).toHaveLength(1);
      expect(dropped[0]).toEqual(finding);
    }
  });

  it('every drop is present in the returned dropped list — never silently vanishes', () => {
    const findings = [
      baseFinding({ id: 'a', file: 'src/legacy/old.ts', severity: 'WARNING', category: 'style' }),
      baseFinding({ id: 'b', file: 'src/api/handler.ts', severity: 'WARNING', category: 'style' }),
      baseFinding({ id: 'c', file: 'src/legacy/old.ts', severity: 'CRITICAL', category: 'security' }),
      baseFinding({ id: 'd', file: 'src/legacy/old.ts', severity: 'CRITICAL', category: 'style' }),
    ];
    const { kept, dropped } = flagOutOfScope(findings, outOfScopeIntent);

    // 'a' (out-of-scope, WARNING+style — neither condition holds) is dropped;
    // 'b' (in-scope), 'c' (out-of-scope but security) and 'd' (out-of-scope
    // but CRITICAL) all survive.
    expect(kept.map((f) => f.id)).toEqual(['b', 'c', 'd']);
    expect(dropped.map((f) => f.id)).toEqual(['a']);
  });
});
