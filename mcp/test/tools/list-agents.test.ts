import { afterEach, describe, expect, it } from 'vitest';
import { ListAgentsOutput } from '../../src/schemas.js';
import { makeFakeApiClient } from '../helpers/fake-api-client.js';
import { makeAgent } from '../helpers/fixtures.js';
import { buildHarness } from '../helpers/harness.js';

describe('list_agents (round-trip through a real MCP server + client)', () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it('returns only enabled agents by default, validating against its own outputSchema', async () => {
    const api = makeFakeApiClient({
      listAgents: async () => [
        makeAgent({ name: 'Enabled', enabled: true }),
        makeAgent({ name: 'Disabled', enabled: false }),
      ],
    });
    const harness = await buildHarness(api);
    close = harness.close;

    const result = await harness.client.callTool({ name: 'list_agents', arguments: {} });

    expect(result.isError).toBeFalsy();
    const payload = ListAgentsOutput.parse(result.structuredContent);
    expect(payload.count).toBe(1);
    expect(payload.agents[0]!.name).toBe('Enabled');
  });

  it('includes disabled agents when enabled_only is false', async () => {
    const api = makeFakeApiClient({
      listAgents: async () => [makeAgent({ name: 'Disabled', enabled: false })],
    });
    const harness = await buildHarness(api);
    close = harness.close;

    const result = await harness.client.callTool({
      name: 'list_agents',
      arguments: { enabled_only: false },
    });

    const payload = ListAgentsOutput.parse(result.structuredContent);
    expect(payload.count).toBe(1);
  });

  it('caps each agent description at 120 chars', async () => {
    const api = makeFakeApiClient({
      listAgents: async () => [makeAgent({ description: 'd'.repeat(200) })],
    });
    const harness = await buildHarness(api);
    close = harness.close;

    const result = await harness.client.callTool({ name: 'list_agents', arguments: {} });
    const payload = ListAgentsOutput.parse(result.structuredContent);
    expect(payload.agents[0]!.description.length).toBe(120);
  });

  // This was the one tool whose page skipped CHARACTER_LIMIT entirely — short
  // in practice is not a bound, and the cap is a per-tool invariant.
  it('caps the page at CHARACTER_LIMIT and says how many agents it dropped', async () => {
    const many = Array.from({ length: 400 }, (_, i) =>
      makeAgent({ id: `agent-${i}`, name: `Agent ${i}`, description: 'd'.repeat(120) }),
    );
    const api = makeFakeApiClient({ listAgents: async () => many });
    const harness = await buildHarness(api);
    close = harness.close;

    const result = await harness.client.callTool({ name: 'list_agents', arguments: {} });

    const payload = ListAgentsOutput.parse(result.structuredContent);
    expect(payload.truncated).toBe(true);
    expect(payload.count).toBeLessThan(400);
    expect(payload.count).toBe(payload.agents.length);
    expect(JSON.stringify(payload.agents).length).toBeLessThanOrEqual(25_000);
    expect(payload.message).toMatch(new RegExp(`${400 - payload.count} more agent`));
  });

  it('returns isError with no structuredContent when the API is unreachable', async () => {
    const api = makeFakeApiClient({
      listAgents: async () => {
        throw new Error('Could not reach the DevDigest API. Start it with ./scripts/dev.sh, then retry.');
      },
    });
    const harness = await buildHarness(api);
    close = harness.close;

    const result = await harness.client.callTool({ name: 'list_agents', arguments: {} });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect((result.content as { text: string }[])[0]!.text).toMatch(/dev\.sh/);
  });
});
