import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Review,
  Finding,
  Intent,
  BlastRadius,
  Risks,
  PrHistory,
  SmartDiff,
  Conformance,
  Onboarding,
  EvalRun,
  MemoryItem,
  RunTrace,
  Settings,
  Repo,
  PrDetail,
  SkillInput,
  SkillPatch,
  MAX_SKILL_BODY_CHARS,
  SpecFile,
  ContextListing,
  ContextPaths,
  MAX_CONTEXT_PATH_LEN,
  MAX_CONTEXT_PATHS,
} from '@devdigest/shared';
import { API_CONTRACT_GATE_SKILL } from '../src/db/seed-prompts.js';

/**
 * Contract tests — parse/round-trip the fixtures from data.jsx/data2.jsx
 * so feature agents can rely on the schemas matching the prototype data.
 */
describe('AI contracts parse fixtures', () => {
  it('Review + Finding (data.jsx VERDICT/FINDINGS)', () => {
    const review = Review.parse({
      verdict: 'request_changes',
      summary: 'Two blockers before merge.',
      score: 61,
      findings: [
        {
          id: 'f1',
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded Stripe secret key in commit',
          file: 'src/config.ts',
          start_line: 12,
          end_line: 12,
          rationale: 'Line 12 contains a literal `sk_live_` Stripe key.',
          suggestion: 'Move to env and rotate.',
          confidence: 0.98,
          kind: 'secret_leak',
        },
      ],
    });
    expect(review.findings).toHaveLength(1);
    expect(review.score).toBe(61);
  });

  it('lethal-trifecta Finding variant', () => {
    const f = Finding.parse({
      id: 'f2',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Lethal trifecta',
      file: 'src/api/public/webhooks.ts',
      start_line: 61,
      end_line: 74,
      rationale: 'all three legs present',
      confidence: 0.79,
      kind: 'lethal_trifecta',
      trifecta_components: ['private_data_access', 'untrusted_input', 'exfil_path'],
      evidence: [{ component: 'untrusted_input', file: 'src/api/public/webhooks.ts', line: 61 }],
    });
    expect(f.trifecta_components).toContain('exfil_path');
  });

  it('Intent / BlastRadius / Risks / PrHistory', () => {
    expect(() =>
      Intent.parse({
        intent: 'x',
        in_scope: ['a'],
        out_of_scope: ['b'],
        risk_areas: ['auth'],
        confidence: 0.5,
        sources: [{ type: 'description', status: 'used' }],
      }),
    ).not.toThrow();
    expect(() =>
      BlastRadius.parse({
        changed_symbols: [{ name: 'rateLimit', file: 'a.ts', kind: 'function' }],
        downstream: [
          {
            symbol: 'rateLimit',
            callers: [{ name: 'publicRouter', file: 'b.ts', line: 23, rank: 0.42 }],
            endpoints_affected: ['GET /x'],
            crons_affected: ['c'],
          },
        ],
        summary: 's',
        status: 'full',
        indexed_sha: 'abc1234',
      }),
    ).not.toThrow();
    // `reason` rides along only when the index could not back the map.
    expect(() =>
      BlastRadius.parse({
        changed_symbols: [],
        downstream: [],
        summary: 's',
        status: 'degraded',
        reason: 'no_data',
        indexed_sha: null,
      }),
    ).not.toThrow();
    expect(() =>
      Risks.parse({
        risks: [{ kind: 'security', title: 't', explanation: 'e', severity: 'high', file_refs: [] }],
      }),
    ).not.toThrow();
    expect(() =>
      PrHistory.parse({
        history: [
          {
            pr_number: 401,
            title: 't',
            merged_at: '2026-03-18',
            author: 'a',
            files_overlap: [],
            notes: 'n',
          },
        ],
      }),
    ).not.toThrow();
  });

  it('SmartDiff (data.jsx DIFF)', () => {
    const d = SmartDiff.parse({
      groups: [
        {
          role: 'core',
          files: [{ path: 'a.ts', additions: 84, deletions: 0, finding_lines: [28, 52] }],
        },
      ],
      split_suggestion: { too_big: false, total_lines: 285, proposed_splits: [] },
    });
    expect(d.groups[0]!.role).toBe('core');
  });

  it('Conformance / Onboarding / EvalRun / MemoryItem', () => {
    expect(() =>
      Conformance.parse({
        spec_id: 's1',
        spec_title: 'Spec',
        items: [{ requirement: 'r', status: 'implemented' }],
        completeness_pct: 80,
      }),
    ).not.toThrow();
    expect(() =>
      Onboarding.parse({
        sections: [{ kind: 'architecture', title: 'T', body: 'b', links: [] }],
      }),
    ).not.toThrow();
    expect(() =>
      EvalRun.parse({
        recall: 0.82,
        precision: 0.91,
        citation_accuracy: 0.95,
        traces_passed: 17,
        traces_total: 20,
        duration_ms: 12000,
        cost_usd: 0.23,
        per_trace: [{ name: 't01', pass: true, expected: 'x', actual: 'x' }],
      }),
    ).not.toThrow();
    expect(() =>
      MemoryItem.parse({
        content: 'c',
        scope: 'team',
        kind: 'decision',
        confidence: 0.92,
        sources: [{ pr: 401, context: 'ctx' }],
      }),
    ).not.toThrow();
  });

  it('RunTrace (data2.jsx TRACE single-document)', () => {
    const trace = RunTrace.parse({
      config: { agent: 'Security Reviewer', version: 'v7', model: 'gpt-4.1', pr: 482, source: 'local' },
      stats: {
        duration_ms: 8200,
        tokens_in: 14820,
        tokens_out: 1240,
        cost_usd: 0.0637,
        findings: 3,
        grounding: '3/3 passed',
      },
      prompt_assembly: { system: 's', user: 'u' },
      tool_calls: [{ tool: 'read_file', args: "'src/config.ts'", meta: '1,240 bytes', ms: 120 }],
      raw_output: '{}',
      memory_pulled: [{ pr: 288, text: 'verified via stripe-signature' }],
      specs_read: ['specs/security-baseline.md'],
      log: [{ t: '00.00', kind: 'info', msg: 'started' }],
    });
    expect(trace.tool_calls).toHaveLength(1);
  });
});

describe('platform DTOs', () => {
  it('Settings defaults + passthrough', () => {
    const s = Settings.parse({ extra_key: 'x' });
    expect(s.theme).toBe('dark');
    expect((s as Record<string, unknown>).extra_key).toBe('x');
  });

  it('Repo + PrDetail', () => {
    expect(() =>
      Repo.parse({
        id: 'r1',
        workspace_id: 'w1',
        owner: 'acme',
        name: 'payments-api',
        full_name: 'acme/payments-api',
        default_branch: 'main',
        clone_path: null,
        last_polled_at: null,
        created_by: null,
      }),
    ).not.toThrow();
    expect(() =>
      PrDetail.parse({
        number: 482,
        title: 't',
        author: 'a',
        branch: 'b',
        base: 'main',
        head_sha: 'sha',
        additions: 1,
        deletions: 0,
        files_count: 1,
        status: 'open',
        files: [],
        commits: [],
      }),
    ).not.toThrow();
  });
});

describe('SkillInput bounds the body', () => {
  // The body is pasted verbatim into every review prompt of every agent that
  // links the skill, and nothing downstream bounds it — `assemblePrompt` joins
  // the linked bodies whole. The import path can hand over a 1 MiB markdown
  // entry, so without this the size of a review prompt is decided by whatever
  // file someone dragged in, and the failure surfaces at the provider as a
  // context-length error on every later run of that agent.
  const base = { name: 'rubric', body: 'x' };

  it('accepts a body exactly at the cap', () => {
    const body = 'x'.repeat(MAX_SKILL_BODY_CHARS);
    expect(() => SkillInput.parse({ ...base, body })).not.toThrow();
  });

  it('rejects one character past it', () => {
    const body = 'x'.repeat(MAX_SKILL_BODY_CHARS + 1);
    expect(() => SkillInput.parse({ ...base, body })).toThrow();
  });

  it('still rejects an empty body', () => {
    expect(() => SkillInput.parse({ ...base, body: '' })).toThrow();
  });

  it('applies the same bound to a patch', () => {
    const body = 'x'.repeat(MAX_SKILL_BODY_CHARS + 1);
    expect(() => SkillPatch.parse({ body })).toThrow();
  });

  it('leaves room for the largest rubric the product ships', () => {
    // Guards the constant itself: a cap tightened below the seeded skills would
    // make the app's own content unsaveable.
    expect(MAX_SKILL_BODY_CHARS).toBeGreaterThan(API_CONTRACT_GATE_SKILL.length * 2);
  });
});

describe('ContextListing wraps SpecFile with directory metadata', () => {
  it('parses a listing with badge fields on each file', () => {
    expect(() =>
      ContextListing.parse({
        files: [
          {
            path: 'specs/SPEC-01-project-context.md',
            root: 'specs',
            size: 4096,
            updated_at: '2026-08-01T00:00:00.000Z',
            tokens_est: 1024,
            used_by_agents: 2,
          },
        ],
        total: 1,
        truncated: false,
        roots: ['specs', 'docs', 'insights'],
        file_names: ['INSIGHTS.md'],
        scanned_at: '2026-08-18T00:00:00.000Z',
      }),
    ).not.toThrow();
  });

  it('accepts an empty listing (no .md under the configured roots)', () => {
    expect(() =>
      ContextListing.parse({
        files: [],
        total: 0,
        truncated: false,
        roots: ['specs', 'docs', 'insights'],
        file_names: ['INSIGHTS.md'],
        scanned_at: '2026-08-18T00:00:00.000Z',
      }),
    ).not.toThrow();
  });

  it('SpecFile still parses without the new badge fields (single-doc read)', () => {
    expect(() =>
      SpecFile.parse({
        path: 'docs/README.md',
        content: '# hi',
      }),
    ).not.toThrow();
  });

  it('parses a listing that carries file_names alongside roots', () => {
    expect(() =>
      ContextListing.parse({
        files: [],
        total: 0,
        truncated: false,
        roots: ['specs', 'docs'],
        file_names: ['INSIGHTS.md'],
        scanned_at: '2026-08-18T00:00:00.000Z',
      }),
    ).not.toThrow();
  });

  it('rejects a listing missing file_names — proves the field is required on the resolved schema', () => {
    const withoutFileNames = {
      files: [],
      total: 0,
      truncated: false,
      roots: ['specs', 'docs'],
      scanned_at: '2026-08-18T00:00:00.000Z',
    };
    expect(() => ContextListing.parse(withoutFileNames)).toThrow();
  });

  it('carries file_names as a required field in BOTH @devdigest/shared copies on disk (code-review, fix pass 1, item 3)', () => {
    // `@devdigest/shared` resolves to `./src/vendor/shared` in this package's
    // tsconfig/vitest alias (server/tsconfig.json, server/vitest.config.ts) —
    // every `ContextListing.parse(...)` test above exercises the SERVER copy
    // only, never the client mirror. A rebase that drops the client mirror
    // hunk would leave those tests green while the copies diverge, so this
    // reads both files' source directly (no module resolution, no alias) and
    // requires the same required, non-optional field declaration in each.
    const requiredFileNamesField = /file_names:\s*z\.array\(z\.string\(\)\)\s*,/;
    const testDir = dirname(fileURLToPath(import.meta.url));
    const serverSrc = readFileSync(
      resolve(testDir, '../src/vendor/shared/contracts/platform.ts'),
      'utf8',
    );
    const clientSrc = readFileSync(
      resolve(testDir, '../../client/src/vendor/shared/contracts/platform.ts'),
      'utf8',
    );
    expect(serverSrc).toMatch(requiredFileNamesField);
    expect(clientSrc).toMatch(requiredFileNamesField);
  });
});

describe('ContextPaths bounds and shapes the attachment set', () => {
  const validPath = 'specs/SPEC-01-project-context.md';

  it('accepts a well-formed repo-relative .md path', () => {
    expect(() => ContextPaths.parse({ paths: [validPath] })).not.toThrow();
  });

  it('accepts an empty set (detach everything)', () => {
    expect(() => ContextPaths.parse({ paths: [] })).not.toThrow();
  });

  it('rejects a leading slash', () => {
    expect(() => ContextPaths.parse({ paths: ['/specs/a.md'] })).toThrow();
  });

  it('rejects .. traversal', () => {
    expect(() => ContextPaths.parse({ paths: ['specs/../../etc/passwd.md'] })).toThrow();
  });

  it('rejects a backslash (not POSIX)', () => {
    expect(() => ContextPaths.parse({ paths: ['specs\\a.md'] })).toThrow();
  });

  it('rejects a non-.md extension', () => {
    expect(() => ContextPaths.parse({ paths: ['specs/a.txt'] })).toThrow();
  });

  it('rejects a path past MAX_CONTEXT_PATH_LEN', () => {
    const long = 'specs/' + 'a'.repeat(MAX_CONTEXT_PATH_LEN) + '.md';
    expect(() => ContextPaths.parse({ paths: [long] })).toThrow();
  });

  it('rejects more paths than MAX_CONTEXT_PATHS', () => {
    const paths = Array.from({ length: MAX_CONTEXT_PATHS + 1 }, (_, i) => `specs/f${i}.md`);
    expect(() => ContextPaths.parse({ paths })).toThrow();
  });

  it('accepts exactly MAX_CONTEXT_PATHS entries', () => {
    const paths = Array.from({ length: MAX_CONTEXT_PATHS }, (_, i) => `specs/f${i}.md`);
    expect(() => ContextPaths.parse({ paths })).not.toThrow();
  });
});
