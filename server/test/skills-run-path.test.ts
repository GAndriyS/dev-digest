import { describe, it, expect } from 'vitest';
import type { RunTrace } from '@devdigest/shared';
import { runBus } from '../src/platform/sse.js';
import { MockGitClient, MockLLMProvider } from '../src/adapters/mocks.js';
import { ReviewRunExecutor } from '../src/modules/reviews/run-executor.js';
import type { ReviewRepository } from '../src/modules/reviews/repository.js';
import type { Container } from '../src/platform/container.js';
import type { AgentRow, PullRow } from '../src/db/rows.js';
import type * as schema from '../src/db/schema.js';
import type { RunSkillEntry } from '../src/modules/skills/repository.js';

/**
 * L02 — the run path. Before this lesson, linking a skill to an agent had ZERO
 * effect: `reviewPullRequest` was called without `skills`. These tests pin the
 * two halves of the fix — the bodies reach the prompt in order, and the run
 * records WHICH skill (and which body version) it used.
 *
 * Hermetic: mock LLM/git adapters, stub repositories, no database.
 */

/** The one file MockGitClient's default diff touches: line 11 is the added one. */
const REVIEW_FIXTURE = {
  verdict: 'request_changes',
  summary: 'Hardcoded key.',
  score: 20,
  findings: [
    {
      id: 'f1',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live key was added.',
      suggestion: 'Read it from the environment.',
      confidence: 0.95,
    },
  ],
};

const AGENT = {
  id: 'a1',
  name: 'Security Reviewer',
  description: '',
  provider: 'openai',
  model: 'gpt-4o-mini',
  systemPrompt: 'Review the diff.',
  outputSchema: null,
  enabled: true,
  version: 1,
  strategy: 'single-pass',
  ciFailOn: 'critical',
  // Off so the run makes no repo-intel calls — this test is about skills.
  repoIntel: false,
} as unknown as AgentRow;

const PULL = {
  id: 'pr1',
  repoId: 'r1',
  number: 482,
  title: 'Add rate limiting',
  base: 'main',
  headSha: 'a1b2c3d4',
  body: null,
} as unknown as PullRow;

const REPO_ROW = { id: 'r1', owner: 'acme', name: 'payments-api' } as unknown as typeof schema.repos.$inferSelect;

interface Harness {
  executor: ReviewRunExecutor;
  llm: MockLLMProvider;
  traces: RunTrace[];
  recorded: { runId: string; entries: RunSkillEntry[] }[];
}

function harness(
  linked: { id: string; name: string; body: string; enabled: boolean; version: number }[],
): Harness {
  const llm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
  const traces: RunTrace[] = [];
  const recorded: { runId: string; entries: RunSkillEntry[] }[] = [];

  const container = {
    runBus,
    git: new MockGitClient(),
    llm: async () => llm,
    skillsRepo: {
      recordRunSkills: async (runId: string, entries: RunSkillEntry[]) => {
        recorded.push({ runId, entries });
      },
    },
  } as unknown as Container;

  const repo = {
    getPrFiles: async () => [],
    insertReview: async () => ({ id: 'rev1' }),
    insertFindings: async (_reviewId: string, findings: unknown[]) =>
      findings.map((_f, i) => ({ id: `f${i}` })),
    markReviewed: async () => undefined,
    completeAgentRun: async () => undefined,
    saveRunTrace: async (_runId: string, trace: RunTrace) => {
      traces.push(trace);
    },
  } as unknown as ReviewRepository;

  const agents = {
    linkedSkills: async () => linked.map((skill, order) => ({ skill, order })),
  } as unknown as Container['agentsRepo'];

  return { executor: new ReviewRunExecutor(container, repo, agents), llm, traces, recorded };
}

describe('review run path — linked skills reach the prompt', () => {
  it('renders enabled linked skills into the prompt, in link order', async () => {
    const h = harness([
      { id: 'sk1', name: 'alpha', body: 'ALPHA BODY', enabled: true, version: 2 },
      { id: 'sk2', name: 'beta', body: 'BETA BODY', enabled: true, version: 7 },
    ]);
    await h.executor.executeRuns('w1', PULL, REPO_ROW, [{ agent: AGENT, runId: 'run-order' }]);

    // The engine joins skill bodies with a blank line into ONE prompt section;
    // the trace records exactly what was sent.
    expect(h.traces[0]!.prompt_assembly.skills).toBe('ALPHA BODY\n\nBETA BODY');

    const sent = JSON.stringify(h.llm.calls[0]!.req);
    expect(sent.indexOf('ALPHA BODY')).toBeGreaterThan(-1);
    expect(sent.indexOf('ALPHA BODY')).toBeLessThan(sent.indexOf('BETA BODY'));
  });

  it('skips DISABLED skills — "enabled" is a real kill switch, not a label', async () => {
    const h = harness([
      { id: 'sk1', name: 'alpha', body: 'ALPHA BODY', enabled: true, version: 2 },
      { id: 'sk2', name: 'beta', body: 'BETA BODY', enabled: false, version: 1 },
      { id: 'sk3', name: 'gamma', body: 'GAMMA BODY', enabled: true, version: 5 },
    ]);
    await h.executor.executeRuns('w1', PULL, REPO_ROW, [{ agent: AGENT, runId: 'run-disabled' }]);

    expect(h.traces[0]!.prompt_assembly.skills).toBe('ALPHA BODY\n\nGAMMA BODY');
    expect(JSON.stringify(h.llm.calls[0]!.req)).not.toContain('BETA BODY');
  });

  it('records run_skills with the body version and the POST-FILTER prompt order', async () => {
    const h = harness([
      { id: 'sk1', name: 'alpha', body: 'ALPHA BODY', enabled: true, version: 2 },
      { id: 'sk2', name: 'beta', body: 'BETA BODY', enabled: false, version: 1 },
      { id: 'sk3', name: 'gamma', body: 'GAMMA BODY', enabled: true, version: 5 },
    ]);
    await h.executor.executeRuns('w1', PULL, REPO_ROW, [{ agent: AGENT, runId: 'run-record' }]);

    expect(h.recorded).toHaveLength(1);
    expect(h.recorded[0]!.runId).toBe('run-record');
    expect(h.recorded[0]!.entries).toEqual([
      { skillId: 'sk1', skillVersion: 2, order: 0 },
      // gamma is order 1, not 2: `order` is where it landed in the PROMPT.
      { skillId: 'sk3', skillVersion: 5, order: 1 },
    ]);
  });

  it('omits the skills slot entirely when the agent links none', async () => {
    const h = harness([]);
    await h.executor.executeRuns('w1', PULL, REPO_ROW, [{ agent: AGENT, runId: 'run-empty' }]);
    expect(h.traces[0]!.prompt_assembly.skills).toBeNull();
    expect(h.recorded[0]?.entries ?? []).toEqual([]);
  });
});
