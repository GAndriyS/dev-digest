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
    expect(payload.count).toBe(1);
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
    expect(payload.count).toBe(0);
    expect(payload.message).toMatch(/pending/);
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
    expect(payload.count).toBe(1);
    expect(payload.conventions[0]!.status).toBe('pending');
  });
});
