import { afterEach, describe, expect, it } from 'vitest';
import { GetFindingsOutput } from '../../src/schemas.js';
import { makeFakeApiClient } from '../helpers/fake-api-client.js';
import { makeFinding, makePr, makeRepo, makeReview } from '../helpers/fixtures.js';
import { buildHarness } from '../helpers/harness.js';

const REPO = makeRepo();
const PR = makePr();

function apiWithReviews(reviews: ReturnType<typeof makeReview>[]) {
  return makeFakeApiClient({
    listRepos: async () => [REPO],
    listPulls: async () => [PR],
    listReviews: async () => reviews,
  });
}

describe('get_findings (round-trip through a real MCP server + client)', () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it('aggregates across every review and excludes dismissed findings (decision 2)', async () => {
    const api = apiWithReviews([
      makeReview({
        agent_name: 'A',
        findings: [
          makeFinding({ id: 'f1', severity: 'CRITICAL' }),
          makeFinding({ id: 'f2', dismissed_at: '2026-01-01' }),
        ],
      }),
      makeReview({ agent_name: 'B', findings: [makeFinding({ id: 'f3', severity: 'WARNING' })] }),
    ]);
    const harness = await buildHarness(api);
    close = harness.close;

    const result = await harness.client.callTool({
      name: 'get_findings',
      arguments: { repo: 'devdigest/demo', pr: 42 },
    });

    const payload = GetFindingsOutput.parse(result.structuredContent);
    expect(payload.total).toBe(2);
    expect(payload.findings.map((f) => f.title)).toHaveLength(2);
    expect(payload.counts).toEqual({ critical: 1, warning: 1, suggestion: 0 });
  });

  // Regression: pass the whole `.strict()` object as `inputSchema`, never
  // `.shape`. With a raw shape the SDK rebuilds a NON-strict object to validate
  // calls, so `.strict()` reaches only the advertised JSON Schema and a typo'd
  // argument is silently dropped — the caller's filter or page size quietly
  // does nothing. Caught by a live probe, not by the suite, so it is pinned.
  it('rejects an unrecognized argument instead of silently ignoring it', async () => {
    const api = apiWithReviews([makeReview({ findings: [makeFinding({ id: 'f1' })] })]);
    const harness = await buildHarness(api);
    close = harness.close;

    const result = await harness.client.callTool({
      name: 'get_findings',
      arguments: { repo: 'devdigest/demo', pr: 42, sevrity: 'CRITICAL' },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    const text = (result.content as { text: string }[])[0]!.text;
    expect(text).toContain('get_findings');
    expect(text).toContain('sevrity');
  });

  it('filters by severity while counts still reflect the whole PR', async () => {
    const api = apiWithReviews([
      makeReview({
        findings: [
          makeFinding({ id: 'f1', severity: 'CRITICAL' }),
          makeFinding({ id: 'f2', severity: 'WARNING' }),
        ],
      }),
    ]);
    const harness = await buildHarness(api);
    close = harness.close;

    const result = await harness.client.callTool({
      name: 'get_findings',
      arguments: { repo: 'devdigest/demo', pr: 42, severity: 'CRITICAL' },
    });

    const payload = GetFindingsOutput.parse(result.structuredContent);
    expect(payload.total).toBe(1);
    expect(payload.counts).toEqual({ critical: 1, warning: 1, suggestion: 0 });
  });

  it('paginates with limit/offset and sets next_offset', async () => {
    const findings = Array.from({ length: 5 }, (_, i) => makeFinding({ id: `f${i}`, file: `${i}.ts` }));
    const api = apiWithReviews([makeReview({ findings })]);
    const harness = await buildHarness(api);
    close = harness.close;

    const result = await harness.client.callTool({
      name: 'get_findings',
      arguments: { repo: 'devdigest/demo', pr: 42, limit: 2, offset: 0 },
    });

    const payload = GetFindingsOutput.parse(result.structuredContent);
    expect(payload.returned).toBe(2);
    expect(payload.total).toBe(5);
    expect(payload.next_offset).toBe(2);
  });

  it('returns zero findings with an onward message when the PR was never reviewed', async () => {
    const api = apiWithReviews([]);
    const harness = await buildHarness(api);
    close = harness.close;

    const result = await harness.client.callTool({
      name: 'get_findings',
      arguments: { repo: 'devdigest/demo', pr: 42 },
    });

    const payload = GetFindingsOutput.parse(result.structuredContent);
    expect(payload.total).toBe(0);
    expect(payload.message).toMatch(/run_agent_on_pr/);
  });

  it('names known PR numbers when the PR number does not match', async () => {
    const api = makeFakeApiClient({
      listRepos: async () => [REPO],
      listPulls: async () => [makePr({ number: 7 })],
    });
    const harness = await buildHarness(api);
    close = harness.close;

    const result = await harness.client.callTool({
      name: 'get_findings',
      arguments: { repo: 'devdigest/demo', pr: 999 },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect((result.content as { text: string }[])[0]!.text).toMatch(/7/);
  });
});
