import { afterEach, describe, expect, it } from 'vitest';
import type { Config } from '../../src/config.js';
import { RunAgentOnPrOutput } from '../../src/schemas.js';
import { makeFakeApiClient } from '../helpers/fake-api-client.js';
import { makeAgent, makeFinding, makePr, makeRepo, makeReview, makeRunSummary } from '../helpers/fixtures.js';
import { buildHarness, testConfig } from '../helpers/harness.js';

const REPO = makeRepo();
const PR = makePr();

describe('run_agent_on_pr (round-trip through a real MCP server + client)', () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it('starts all enabled agents when agent is omitted, waits, and returns the worst-of verdict', async () => {
    const api = makeFakeApiClient({
      listRepos: async () => [REPO],
      listPulls: async () => [PR],
      startReview: async () => [
        { run_id: 'run-1', agent_id: 'agent-1', agent_name: 'A' },
        { run_id: 'run-2', agent_id: 'agent-2', agent_name: 'B' },
      ],
      listRuns: async () => [
        makeRunSummary({ run_id: 'run-1', agent_name: 'A', status: 'done' }),
        makeRunSummary({ run_id: 'run-2', agent_name: 'B', status: 'done' }),
      ],
      listReviews: async () => [
        makeReview({
          run_id: 'run-1',
          agent_name: 'A',
          verdict: 'comment',
          findings: [makeFinding({ id: 'f1' })],
        }),
        makeReview({ run_id: 'run-2', agent_name: 'B', verdict: 'request_changes', findings: [] }),
      ],
    });
    const harness = await buildHarness(api);
    close = harness.close;

    const result = await harness.client.callTool({
      name: 'run_agent_on_pr',
      arguments: { repo: 'devdigest/demo', pr: 42 },
    });

    expect(result.isError).toBeFalsy();
    const payload = RunAgentOnPrOutput.parse(result.structuredContent);
    expect(payload.status).toBe('completed');
    expect(payload.verdict).toBe('request_changes');
    expect(payload.agents_run).toHaveLength(2);
    expect(payload.findings).toHaveLength(1);
    expect(api.startReview).toHaveBeenCalledWith('pr-1', { all: true });
  });

  it('resolves the named agent to an id and starts only that agent', async () => {
    const api = makeFakeApiClient({
      listRepos: async () => [REPO],
      listPulls: async () => [PR],
      listAgents: async () => [makeAgent({ id: 'agent-9', name: 'Solo' })],
      startReview: async () => [{ run_id: 'run-1', agent_id: 'agent-9', agent_name: 'Solo' }],
      listRuns: async () => [makeRunSummary({ run_id: 'run-1', agent_name: 'Solo', status: 'done' })],
      listReviews: async () => [makeReview({ run_id: 'run-1', agent_name: 'Solo', findings: [] })],
    });
    const harness = await buildHarness(api);
    close = harness.close;

    await harness.client.callTool({
      name: 'run_agent_on_pr',
      arguments: { repo: 'devdigest/demo', pr: 42, agent: 'solo' },
    });

    expect(api.startReview).toHaveBeenCalledWith('pr-1', { agentId: 'agent-9' });
  });

  it('reports a partial outcome when one agent fails without hiding the other', async () => {
    const api = makeFakeApiClient({
      listRepos: async () => [REPO],
      listPulls: async () => [PR],
      startReview: async () => [
        { run_id: 'run-1', agent_id: 'agent-1', agent_name: 'A' },
        { run_id: 'run-2', agent_id: 'agent-2', agent_name: 'B' },
      ],
      listRuns: async () => [
        makeRunSummary({ run_id: 'run-1', agent_name: 'A', status: 'done' }),
        makeRunSummary({ run_id: 'run-2', agent_name: 'B', status: 'failed', error: 'boom' }),
      ],
      listReviews: async () => [makeReview({ run_id: 'run-1', agent_name: 'A', findings: [] })],
    });
    const harness = await buildHarness(api);
    close = harness.close;

    const result = await harness.client.callTool({
      name: 'run_agent_on_pr',
      arguments: { repo: 'devdigest/demo', pr: 42 },
    });

    const payload = RunAgentOnPrOutput.parse(result.structuredContent);
    expect(payload.status).toBe('partial');
    const failed = payload.agents_run.find((a) => a.agent === 'B');
    expect(failed?.error).toBe('boom');
  });

  it('returns a structured timeout result (not an error) naming get_findings when the wait cap is hit', async () => {
    const api = makeFakeApiClient({
      listRepos: async () => [REPO],
      listPulls: async () => [PR],
      startReview: async () => [{ run_id: 'run-1', agent_id: 'agent-1', agent_name: 'A' }],
      listRuns: async () => [makeRunSummary({ run_id: 'run-1', agent_name: 'A', status: 'running' })],
      listReviews: async () => [],
    });
    const shortConfig: Config = { ...testConfig, runTimeoutMs: 20, pollIntervalMs: 5 };
    const harness = await buildHarness(api, shortConfig);
    close = harness.close;

    const result = await harness.client.callTool({
      name: 'run_agent_on_pr',
      arguments: { repo: 'devdigest/demo', pr: 42 },
    });

    expect(result.isError).toBeFalsy();
    const payload = RunAgentOnPrOutput.parse(result.structuredContent);
    expect(payload.status).toBe('timeout');
    expect(payload.message).toMatch(/get_findings/);
  });

  // The API answers 200 `{runs: []}` when `all:true` matches no enabled agent.
  // Polling an empty id set terminates instantly, so before the guard this
  // returned `completed` with a null verdict — a review that never ran, read as
  // a review that found nothing.
  it('refuses to report a clean run when no agent was started', async () => {
    const api = makeFakeApiClient({
      listRepos: async () => [REPO],
      listPulls: async () => [PR],
      startReview: async () => [],
    });
    const harness = await buildHarness(api);
    close = harness.close;

    const result = await harness.client.callTool({
      name: 'run_agent_on_pr',
      arguments: { repo: 'devdigest/demo', pr: 42 },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect((result.content as { text: string }[])[0]!.text).toMatch(/list_agents/);
    expect(api.listRuns).not.toHaveBeenCalled();
  });

  it('names the next call when the agent does not exist', async () => {
    const api = makeFakeApiClient({
      listRepos: async () => [REPO],
      listPulls: async () => [PR],
      listAgents: async () => [makeAgent({ name: 'Real' })],
    });
    const harness = await buildHarness(api);
    close = harness.close;

    const result = await harness.client.callTool({
      name: 'run_agent_on_pr',
      arguments: { repo: 'devdigest/demo', pr: 42, agent: 'ghost' },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect((result.content as { text: string }[])[0]!.text).toMatch(/list_agents/);
  });
});
