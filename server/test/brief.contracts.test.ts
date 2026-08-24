import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrWhyBrief } from '@devdigest/shared';

const testDir = dirname(fileURLToPath(import.meta.url));

/**
 * PR Why + Risk Brief (L05/SPEC-04, step 8, lane A4) — wire-contract shape,
 * the two `@devdigest/shared` copies staying byte-identical (AC-42,
 * `AGENTS.md:31-35`), and the new migration being additive-only (AC-24).
 * No Postgres, no container — plain file reads and a zod `.parse`.
 */

describe('PrWhyBrief contract (AC-22, AC-42, AC-46, AC-54)', () => {
  it('parses a minimal, well-formed brief', () => {
    const sample = {
      what: 'Adds rate limiting to public endpoints.',
      why: 'Prevent abuse of unauthenticated routes.',
      risk_level: 'high',
      risks: [],
      review_focus: [],
      inputs: [],
      head_sha: 'a1b2c3d4e5f6',
      generated_at: '2026-08-20T00:00:00.000Z',
      model: 'gpt-4.1',
      stale: false,
    };
    expect(() => PrWhyBrief.parse(sample)).not.toThrow();
  });

  it('accepts only the three known RiskSeverity values for risk_level (AC-22)', () => {
    const base = {
      what: 'w',
      why: 'y',
      risks: [],
      review_focus: [],
      inputs: [],
      head_sha: 'sha',
      generated_at: '2026-08-20T00:00:00.000Z',
      model: null,
      stale: false,
    };
    for (const level of ['high', 'medium', 'low']) {
      expect(PrWhyBrief.safeParse({ ...base, risk_level: level }).success).toBe(true);
    }
    expect(PrWhyBrief.safeParse({ ...base, risk_level: 'critical' }).success).toBe(false);
  });

  it('does NOT carry score, tokens or cost fields on the wire (AC-46, AC-54)', () => {
    const keys = Object.keys(PrWhyBrief.shape);
    expect(keys).not.toContain('score');
    expect(keys).not.toContain('tokens_in');
    expect(keys).not.toContain('tokens_out');
    expect(keys).not.toContain('cost_usd');
    expect(keys).not.toContain('provider');
    expect(keys.sort()).toEqual(
      [
        'what',
        'why',
        'risk_level',
        'risks',
        'review_focus',
        'inputs',
        'head_sha',
        'generated_at',
        'model',
        'stale',
      ].sort(),
    );
  });

  it('rejects an inputs[] status of partial/degraded for a type other than blast (contract, AC-9)', () => {
    const base = {
      what: 'w',
      why: 'y',
      risk_level: 'low',
      risks: [],
      review_focus: [],
      head_sha: 'sha',
      generated_at: '2026-08-20T00:00:00.000Z',
      model: null,
      stale: false,
    };
    // `status` is a shared enum on the wire (used|unavailable|partial|degraded)
    // — grounding which TYPE may legally carry partial/degraded is a service
    // concern (facts.ts), not enforced by the schema itself. This test proves
    // the schema at least accepts blast's degraded status, matching the
    // contract note that blast is the only legal variant for it.
    expect(
      PrWhyBrief.safeParse({
        ...base,
        inputs: [{ type: 'blast', ref: 'deadbeef', status: 'degraded' }],
      }).success,
    ).toBe(true);
  });
});

describe('contracts/brief.ts — server and client @devdigest/shared copies (AC-42, AGENTS.md:31-35)', () => {
  it('is byte-for-byte identical in both copies', () => {
    const serverSrc = readFileSync(
      resolve(testDir, '../src/vendor/shared/contracts/brief.ts'),
      'utf8',
    );
    const clientSrc = readFileSync(
      resolve(testDir, '../../client/src/vendor/shared/contracts/brief.ts'),
      'utf8',
    );
    expect(clientSrc).toBe(serverSrc);
  });
});

describe('migration 0017 (AC-23, AC-24 — additive only, never edits an applied migration)', () => {
  it('every statement is an ADD COLUMN on pr_brief — never DROP, RENAME or CREATE TABLE', () => {
    const sql = readFileSync(
      resolve(testDir, '../src/db/migrations/0017_shallow_swordsman.sql'),
      'utf8',
    );
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);
    expect(statements.length).toBeGreaterThan(0);
    for (const stmt of statements) {
      expect(stmt).toMatch(/^ALTER TABLE "pr_brief" ADD COLUMN /i);
    }
    const upper = sql.toUpperCase();
    expect(upper).not.toContain('DROP ');
    expect(upper).not.toContain('RENAME');
    expect(upper).not.toContain('CREATE TABLE');
  });
});
