import { describe, it, expect, vi } from 'vitest';
import {
  citationAccuracy,
  compareEval,
  currentVersionEntry,
  expectedFindings,
  nextSkillVersion,
  toSkillVersionDto,
} from '../src/modules/skills/helpers.js';
import { SkillsService } from '../src/modules/skills/service.js';
import type { SkillRow, SkillVersionRow } from '../src/modules/skills/repository.js';
import type { Container } from '../src/platform/container.js';

/**
 * Hermetic unit tests for the skills module: the version-bump rule, the
 * restore-as-a-new-version rule, and the eval comparator. No database, no
 * model call — every rule below is a pure function or a service method driven
 * by a stub repository.
 */

const CREATED = new Date('2026-08-01T00:00:00.000Z');

function skillRow(over: Partial<SkillRow> = {}): SkillRow {
  return {
    id: 's1',
    workspaceId: 'w1',
    name: 'no-then-chains',
    description: 'House rule',
    type: 'convention',
    source: 'extracted',
    body: 'v3 body',
    enabled: true,
    version: 3,
    evidenceFiles: null,
    createdAt: CREATED,
    ...over,
  } as SkillRow;
}

function versionRow(over: Partial<SkillVersionRow> = {}): SkillVersionRow {
  return { skillId: 's1', version: 1, body: 'v1 body', createdAt: CREATED, ...over } as SkillVersionRow;
}

describe('nextSkillVersion — the version-bump rule', () => {
  it('bumps when the body changes', () => {
    expect(nextSkillVersion({ version: 3, body: 'old' }, { body: 'new' })).toEqual({
      version: 4,
      bumped: true,
    });
  });

  it('does NOT bump when the body is re-saved unchanged', () => {
    expect(nextSkillVersion({ version: 3, body: 'same' }, { body: 'same' })).toEqual({
      version: 3,
      bumped: false,
    });
  });

  it('does NOT bump on a metadata-only patch (no body key at all)', () => {
    expect(nextSkillVersion({ version: 3, body: 'same' }, {})).toEqual({
      version: 3,
      bumped: false,
    });
  });

  it('treats whitespace as a real change — the model sees it', () => {
    expect(nextSkillVersion({ version: 1, body: 'a' }, { body: 'a ' }).bumped).toBe(true);
  });
});

describe('version DTOs', () => {
  it('omits the body in list mode and always reports body_chars', () => {
    const listed = toSkillVersionDto(versionRow({ body: 'abcdef' }), false);
    expect(listed.body).toBeUndefined();
    expect(listed.body_chars).toBe(6);
    expect(listed.created_at).toBe(CREATED.toISOString());
    expect(toSkillVersionDto(versionRow({ body: 'abcdef' }), true).body).toBe('abcdef');
  });

  it('synthesizes the current version for a never-edited skill', () => {
    const entry = currentVersionEntry(skillRow({ version: 1, body: 'first' }), true);
    expect(entry).toMatchObject({ skill_id: 's1', version: 1, body: 'first', body_chars: 5 });
  });
});

describe('SkillsService.restoreVersion — append-only restore', () => {
  function makeService(over: Record<string, unknown> = {}) {
    const repo = {
      getById: vi.fn(async () => skillRow()),
      getVersion: vi.fn(async (_id: string, v: number) =>
        v === 1 ? versionRow({ version: 1, body: 'v1 body' }) : undefined,
      ),
      listVersions: vi.fn(async () => []),
      restore: vi.fn(async (_ws: string, _id: string, body: string) =>
        skillRow({ body, version: 4 }),
      ),
      ...over,
    };
    const service = new SkillsService({ skillsRepo: repo } as unknown as Container);
    return { service, repo };
  }

  it('copies the chosen body forward as a NEW version instead of rewinding', async () => {
    const { service, repo } = makeService();
    const restored = await service.restoreVersion('w1', 's1', 1);
    // The old body is what gets re-applied…
    expect(repo.restore).toHaveBeenCalledWith('w1', 's1', 'v1 body');
    // …under a HIGHER version number than the one it replaced (3 → 4), never 1.
    expect(restored.version).toBe(4);
    expect(restored.body).toBe('v1 body');
  });

  it('can restore the current version (a no-op edit) — it still mints a new one', async () => {
    const { service, repo } = makeService();
    const restored = await service.restoreVersion('w1', 's1', 3);
    expect(repo.restore).toHaveBeenCalledWith('w1', 's1', 'v3 body');
    expect(restored.version).toBe(4);
  });

  it('404s for a version that was never recorded', async () => {
    const { service } = makeService();
    await expect(service.restoreVersion('w1', 's1', 99)).rejects.toMatchObject({
      code: 'not_found',
      statusCode: 404,
    });
  });

  it('lists a synthetic current version when nothing has been edited yet', async () => {
    const { service } = makeService({
      getById: vi.fn(async () => skillRow({ version: 1, body: 'only body' })),
      listVersions: vi.fn(async () => []),
    });
    const versions = await service.listVersions('w1', 's1');
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ version: 1, body_chars: 9 });
    expect(versions[0]!.body).toBeUndefined();
  });
});

describe('compareEval — the eval pass rule', () => {
  const crit = { severity: 'CRITICAL' };
  const warn = { severity: 'WARNING' };

  it('passes on the same count and the same multiset of severities', () => {
    const r = compareEval([crit, warn], [warn, crit]);
    expect(r.pass).toBe(true);
    expect(r).toMatchObject({ matched: 2, recall: 1, precision: 1 });
  });

  it('ignores category — taxonomy disagreement is not a skill failure', () => {
    const expected = [{ severity: 'CRITICAL', category: 'security' }];
    const actual = [{ severity: 'CRITICAL', category: 'bug' }];
    expect(compareEval(expected, actual).pass).toBe(true);
  });

  it('fails when the count differs, even if every severity matched', () => {
    const r = compareEval([crit], [crit, crit]);
    expect(r.pass).toBe(false);
    expect(r.matched).toBe(1);
    expect(r.recall).toBe(1);
    expect(r.precision).toBe(0.5);
  });

  it('fails when the severities differ at the same count', () => {
    const r = compareEval([crit], [warn]);
    expect(r).toMatchObject({ pass: false, matched: 0, recall: 0, precision: 0 });
  });

  it('expecting nothing and producing nothing passes with 1/1', () => {
    expect(compareEval([], [])).toEqual({ pass: true, matched: 0, recall: 1, precision: 1 });
  });

  it('expecting nothing but producing something fails', () => {
    const r = compareEval([], [crit]);
    expect(r).toMatchObject({ pass: false, recall: 1, precision: 0 });
  });
});

describe('expectedFindings / citationAccuracy', () => {
  it('reads the contract shape out of the untyped jsonb blob', () => {
    expect(expectedFindings({ findings: [{ severity: 'CRITICAL', category: 'security' }] })).toEqual(
      [{ severity: 'CRITICAL', category: 'security' }],
    );
  });

  it('treats a malformed or absent expectation as "expected nothing"', () => {
    expect(expectedFindings(null)).toEqual([]);
    expect(expectedFindings({ findings: [{ severity: 'blocker' }] })).toEqual([]);
    expect(expectedFindings('nope')).toEqual([]);
  });

  it('reports the share of findings that survived grounding', () => {
    expect(citationAccuracy(3, 1)).toBe(0.75);
    expect(citationAccuracy(0, 0)).toBe(1);
    expect(citationAccuracy(0, 2)).toBe(0);
  });
});
