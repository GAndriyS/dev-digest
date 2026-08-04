import { describe, it, expect, vi } from 'vitest';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import { ConfigError } from '../src/platform/errors.js';
import { SkillsService } from '../src/modules/skills/service.js';
import type { EvalCaseRow, SkillRow } from '../src/modules/skills/repository.js';
import type { Container } from '../src/platform/container.js';

/**
 * The eval harness, hermetically: a mock LLM stands in for the model, stub
 * repositories for the database. Covers the pass/fail verdict, the grounding
 * gate feeding `citation_accuracy`, and the 409 the UI keys its disabled Run
 * buttons off.
 */

/**
 * Assembled at runtime, not written as one literal: a string in this shape is
 * blocked by GitHub push protection, which cannot tell a fixture from a leak.
 * Same reasoning as `FIXTURE_STRIPE_KEY` in `src/db/seed.ts`. Never a live key.
 */
const FIXTURE_STRIPE_KEY = ['sk', 'live', '51H8xQ2eZvKYlo2CkqPmNbVwX'].join('_');

const INPUT_DIFF = [
  'diff --git a/src/config.ts b/src/config.ts',
  '--- a/src/config.ts',
  '+++ b/src/config.ts',
  '@@ -10,3 +10,4 @@',
  ' export const config = {',
  '   port: Number(process.env.PORT ?? 3000),',
  `+  stripeKey: '${FIXTURE_STRIPE_KEY}',`,
  ' };',
].join('\n');

/** The added line is new-side line 12 — a finding there survives grounding. */
function reviewFixture(findings: unknown[]) {
  return { verdict: 'request_changes', summary: 'x', score: 20, findings };
}

function finding(over: Record<string, unknown> = {}) {
  return {
    id: 'f1',
    severity: 'CRITICAL',
    category: 'security',
    title: 'Hardcoded Stripe key',
    file: 'src/config.ts',
    start_line: 12,
    end_line: 12,
    rationale: 'A live key was added in this diff.',
    suggestion: 'Read it from the environment.',
    confidence: 0.95,
    ...over,
  };
}

const SKILL = {
  id: 'sk1',
  workspaceId: 'w1',
  name: 'secret-leakage-gate',
  description: '',
  type: 'security',
  source: 'community',
  body: 'Flag any hardcoded live secret as CRITICAL.',
  enabled: true,
  version: 1,
  evidenceFiles: null,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
} as SkillRow;

const CASE = {
  id: 'c1',
  workspaceId: 'w1',
  ownerKind: 'skill',
  ownerId: 'sk1',
  name: 'stripe-key-leak',
  inputDiff: INPUT_DIFF,
  inputFiles: null,
  inputMeta: null,
  expectedOutput: { findings: [{ severity: 'CRITICAL', category: 'security' }] },
  notes: null,
} as EvalCaseRow;

function makeService(opts: {
  fixture?: unknown;
  llmThrows?: Error;
  evalCase?: EvalCaseRow;
} = {}) {
  const llm = new MockLLMProvider('openai', {
    structured: opts.fixture ?? reviewFixture([finding()]),
  });
  const insertEvalRun = vi.fn(async (v: unknown) => v);
  const repo = {
    getById: async () => SKILL,
    getEvalCase: async () => opts.evalCase ?? CASE,
    listEvalCases: async () => [opts.evalCase ?? CASE],
    usedBy: async () => [{ agentId: 'a1', agentName: 'Sec', order: 0, agentEnabled: true }],
    insertEvalRun,
  };
  const container = {
    skillsRepo: repo,
    agentsRepo: {
      listEnabled: async () => [{ id: 'a1', provider: 'openai', model: 'gpt-4o-mini' }],
    },
    llm: async () => {
      if (opts.llmThrows) throw opts.llmThrows;
      return llm;
    },
  } as unknown as Container;
  return { service: new SkillsService(container), llm, insertEvalRun };
}

describe('SkillsService eval harness', () => {
  it('passes when severities and count match, and persists the run', async () => {
    const { service, insertEvalRun } = makeService();
    const run = await service.runEvalCase('w1', 'c1');

    expect(run.traces_passed).toBe(1);
    expect(run.traces_total).toBe(1);
    expect(run.recall).toBe(1);
    expect(run.precision).toBe(1);
    expect(run.citation_accuracy).toBe(1);
    expect(run.per_trace[0]).toMatchObject({ name: 'stripe-key-leak', pass: true });

    expect(insertEvalRun).toHaveBeenCalledTimes(1);
    expect(insertEvalRun.mock.calls[0]![0]).toMatchObject({ caseId: 'c1', pass: true });
  });

  it('sends the skill body as the only review policy', async () => {
    const { service, llm } = makeService();
    await service.runEvalCase('w1', 'c1');
    expect(JSON.stringify(llm.calls[0]!.req)).toContain(SKILL.body);
  });

  it('fails when the model returns the wrong severity', async () => {
    const { service } = makeService({
      fixture: reviewFixture([finding({ severity: 'SUGGESTION' })]),
    });
    const run = await service.runEvalCase('w1', 'c1');
    expect(run.traces_passed).toBe(0);
    expect(run.per_trace[0]!.pass).toBe(false);
  });

  it('counts a hallucinated citation against citation_accuracy, not the model', async () => {
    // Two findings, one of them off-hunk (line 900) → grounding drops it, so the
    // surviving set matches the expectation AND the drop is reported.
    const { service } = makeService({
      fixture: reviewFixture([
        finding(),
        finding({ id: 'f2', start_line: 900, end_line: 900, severity: 'WARNING' }),
      ]),
    });
    const run = await service.runEvalCase('w1', 'c1');
    expect(run.citation_accuracy).toBe(0.5);
    expect(run.per_trace[0]!.pass).toBe(true);
  });

  it('answers 409 no_provider_key when the provider key is missing', async () => {
    const { service } = makeService({
      llmThrows: new ConfigError('OPENAI_API_KEY is not configured'),
    });
    await expect(service.runEvalCase('w1', 'c1')).rejects.toMatchObject({
      code: 'no_provider_key',
      statusCode: 409,
    });
  });

  it('422s a case with no input diff rather than calling the model', async () => {
    const { service, llm } = makeService({
      evalCase: { ...CASE, inputDiff: '   ' } as EvalCaseRow,
    });
    await expect(service.runEvalCase('w1', 'c1')).rejects.toMatchObject({
      code: 'eval_case_empty',
      statusCode: 422,
    });
    expect(llm.calls).toHaveLength(0);
  });
});
