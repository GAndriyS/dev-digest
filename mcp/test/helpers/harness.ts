import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config } from '../../src/config.js';
import type { ApiClient } from '../../src/lib/api-client.js';
import { registerGetBlastRadius } from '../../src/tools/get-blast-radius.js';
import { registerGetConventions } from '../../src/tools/get-conventions.js';
import { registerGetFindings } from '../../src/tools/get-findings.js';
import { registerListAgents } from '../../src/tools/list-agents.js';
import { registerRunAgentOnPr } from '../../src/tools/run-agent-on-pr.js';

/**
 * Fast defaults for the poll loop — real code's 2s/600s defaults would make
 * every run_agent_on_pr test slow for no reason.
 */
export const testConfig: Config = {
  apiUrl: 'http://127.0.0.1:3001',
  runTimeoutMs: 2_000,
  pollIntervalMs: 5,
  requestTimeoutMs: 2_000,
  log: () => {},
};

/**
 * Wires a real `McpServer` (all five tools registered) to a real MCP `Client`
 * over an in-memory transport, substituting a FAKE `ApiClient` at the tool
 * factory seam (plan decision 8) — never `vi.mock` of a module path. This
 * exercises the real `registerTool` schemas (so a `.strict()` violation or an
 * `outputSchema` mismatch fails the test the same way it would fail a real
 * client), not just the handler function in isolation.
 */
export async function buildHarness(api: ApiClient, config: Config = testConfig) {
  const server = new McpServer({ name: 'devdigest-mcp-test', version: '0.0.0' });
  registerListAgents(server, { api });
  registerRunAgentOnPr(server, { api, config });
  registerGetFindings(server, { api });
  registerGetConventions(server, { api });
  registerGetBlastRadius(server);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'devdigest-mcp-test-client', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  return {
    client,
    async close(): Promise<void> {
      await client.close();
      await server.close();
    },
  };
}
