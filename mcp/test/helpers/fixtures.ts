import type {
  Agent,
  ConventionCandidate,
  PrMeta,
  Repo,
  ReviewRecord,
  RunSummary,
} from '@devdigest/shared';

// Type-only imports from @devdigest/shared, erased before esbuild ever needs
// to resolve the module — mcp/vitest.config.ts deliberately carries no alias
// for it, so a VALUE import here would fail fast instead.

export function makeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    workspace_id: 'ws-1',
    owner: 'devdigest',
    name: 'demo',
    full_name: 'devdigest/demo',
    default_branch: 'main',
    clone_path: null,
    last_polled_at: null,
    created_by: null,
    ...overrides,
  };
}

export function makePr(overrides: Partial<PrMeta> = {}): PrMeta {
  return {
    id: 'pr-1',
    number: 42,
    title: 'Add feature',
    author: 'octocat',
    branch: 'feature',
    base: 'main',
    head_sha: 'abc123',
    additions: 10,
    deletions: 2,
    files_count: 1,
    status: 'open',
    opened_at: null,
    updated_at: null,
    ...overrides,
  };
}

export function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-1',
    name: 'Reviewer',
    description: 'A general-purpose reviewer.',
    provider: 'openai',
    model: 'gpt-4.1',
    system_prompt: 'Review this PR.',
    output_schema: null,
    enabled: true,
    version: 1,
    strategy: 'single-pass',
    ci_fail_on: 'critical',
    repo_intel: true,
    ...overrides,
  };
}

export function makeRunSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    run_id: 'run-1',
    agent_id: 'agent-1',
    agent_name: 'Reviewer',
    provider: 'openai',
    model: 'gpt-4.1',
    status: 'done',
    error: null,
    duration_ms: 1000,
    tokens_in: 100,
    tokens_out: 100,
    cost_usd: 0.01,
    findings_count: 1,
    grounding: 'ok',
    ran_at: '2026-01-01T00:00:00.000Z',
    score: 80,
    blockers: 0,
    ...overrides,
  };
}

export function makeReview(overrides: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id: 'review-1',
    pr_id: 'pr-1',
    agent_id: 'agent-1',
    run_id: 'run-1',
    agent_name: 'Reviewer',
    kind: 'review',
    verdict: 'comment',
    summary: 'Looks fine.',
    score: 80,
    model: 'gpt-4.1',
    grounding: 'ok',
    created_at: '2026-01-01T00:00:00.000Z',
    findings: [],
    ...overrides,
  };
}

export function makeFinding(
  overrides: Partial<ReviewRecord['findings'][number]> = {},
): ReviewRecord['findings'][number] {
  return {
    id: 'finding-1',
    severity: 'WARNING',
    category: 'bug',
    title: 'Possible off-by-one',
    file: 'src/index.ts',
    start_line: 10,
    end_line: 12,
    rationale: 'The loop bound looks off by one.',
    suggestion: null,
    confidence: 0.8,
    kind: 'finding',
    trifecta_components: null,
    evidence: null,
    review_id: 'review-1',
    accepted_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

export function makeConvention(overrides: Partial<ConventionCandidate> = {}): ConventionCandidate {
  return {
    id: 'conv-1',
    category: 'style',
    rule: 'Use named exports.',
    evidence_path: 'src/index.ts',
    evidence_snippet: 'export function foo() {}',
    evidence_line: 3,
    confidence: 0.9,
    status: 'accepted',
    ...overrides,
  };
}
