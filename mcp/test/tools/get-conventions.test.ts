import { afterEach, describe, expect, it } from 'vitest';
import { GetConventionsOutput } from '../../src/schemas.js';
import { makeFakeApiClient } from '../helpers/fake-api-client.js';
import { makeConvention, makeRepo } from '../helpers/fixtures.js';
import { buildHarness } from '../helpers/harness.js';

const REPO = makeRepo();

describe('get_conventions (round-trip through a real MCP server + client)', () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it('defaults to accepted conventions and drops the evidence snippet', async () => {
    const api = makeFakeApiClient({
      listRepos: async () => [REPO],
      listConventions: async () => [
        makeConvention({ status: 'accepted', evidence_path: 'src/a.ts', evidence_line: 3 }),
        makeConvention({ status: 'pending' }),
      ],
    });
    const harness = await buildHarness(api);
    close = harness.close;

    const result = await harness.client.callTool({
      name: 'get_conventions',
      arguments: { repo: 'devdigest/demo' },
    });

    const payload = GetConventionsOutput.parse(result.structuredContent);
    expect(payload.returned).toBe(1);
    expect(payload.conventions[0]!.evidence).toBe('src/a.ts:3');
    expect(payload.conventions[0]).not.toHaveProperty('evidence_snippet');
  });

  it('returns [] with an onward message for an un-extracted repo, not an error', async () => {
    const api = makeFakeApiClient({
      listRepos: async () => [REPO],
      listConventions: async () => [],
    });
    const harness = await buildHarness(api);
    close = harness.close;

    const result = await harness.client.callTool({
      name: 'get_conventions',
      arguments: { repo: 'devdigest/demo' },
    });

    expect(result.isError).toBeFalsy();
    const payload = GetConventionsOutput.parse(result.structuredContent);
    expect(payload.returned).toBe(0);
    expect(payload.message).toMatch(/pending/);
  });

  // Security review, WARNING: this was the one tool with no ceiling — `limit`
  // had no max and the page skipped CHARACTER_LIMIT, so one call could hand the
  // caller the whole conventions table. `rule` is extractor (model) output with
  // no length bound of its own.
  it('caps the page and refuses a limit past the maximum', async () => {
    const many = Array.from({ length: 100 }, (_, i) =>
      makeConvention({ status: 'accepted', rule: 'x'.repeat(900), category: `c${i}` }),
    );
    const api = makeFakeApiClient({ listRepos: async () => [REPO], listConventions: async () => many });
    const harness = await buildHarness(api);
    close = harness.close;

    const capped = await harness.client.callTool({
      name: 'get_conventions',
      arguments: { repo: 'devdigest/demo', limit: 100 },
    });
    const payload = GetConventionsOutput.parse(capped.structuredContent);
    expect(payload.truncated).toBe(true);
    expect(payload.returned).toBeLessThan(100);
    expect(JSON.stringify(payload.conventions).length).toBeLessThanOrEqual(25_000);
    // Each rule is truncated on its own, not just the page.
    expect(payload.conventions[0]!.rule.length).toBeLessThanOrEqual(501);

    const rejected = await harness.client.callTool({
      name: 'get_conventions',
      arguments: { repo: 'devdigest/demo', limit: 100_000 },
    });
    expect(rejected.isError).toBe(true);
  });

  // `limit` alone silently dropped the tail: a repo with more accepted
  // conventions than the page size reported `count: 50` and no way to learn
  // there was a 51st.
  it('reports the full total and pages through it with offset/next_offset', async () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      makeConvention({ status: 'accepted', category: `c${i}`, rule: `rule ${i}` }),
    );
    const api = makeFakeApiClient({ listRepos: async () => [REPO], listConventions: async () => many });
    const harness = await buildHarness(api);
    close = harness.close;

    const first = await harness.client.callTool({
      name: 'get_conventions',
      arguments: { repo: 'devdigest/demo', limit: 5 },
    });
    const page1 = GetConventionsOutput.parse(first.structuredContent);
    expect(page1.total).toBe(12);
    expect(page1.returned).toBe(5);
    expect(page1.offset).toBe(0);
    expect(page1.next_offset).toBe(5);

    const last = await harness.client.callTool({
      name: 'get_conventions',
      arguments: { repo: 'devdigest/demo', limit: 5, offset: 10 },
    });
    const page3 = GetConventionsOutput.parse(last.structuredContent);
    expect(page3.returned).toBe(2);
    expect(page3.next_offset).toBeUndefined();
    expect(page3.conventions[1]!.category).toBe('c11');

    const past = await harness.client.callTool({
      name: 'get_conventions',
      arguments: { repo: 'devdigest/demo', offset: 99 },
    });
    const empty = GetConventionsOutput.parse(past.structuredContent);
    expect(empty.total).toBe(12);
    expect(empty.returned).toBe(0);
    expect(empty.message).toMatch(/smaller offset/);
  });

  it('accepts status:"pending" to see unratified candidates', async () => {
    const api = makeFakeApiClient({
      listRepos: async () => [REPO],
      listConventions: async () => [makeConvention({ status: 'pending' })],
    });
    const harness = await buildHarness(api);
    close = harness.close;

    const result = await harness.client.callTool({
      name: 'get_conventions',
      arguments: { repo: 'devdigest/demo', status: 'pending' },
    });

    const payload = GetConventionsOutput.parse(result.structuredContent);
    expect(payload.returned).toBe(1);
    expect(payload.conventions[0]!.status).toBe('pending');
  });
});
