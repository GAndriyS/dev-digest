import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { createApiClient } from './lib/api-client.js';
import { registerGetBlastRadius } from './tools/get-blast-radius.js';
import { registerGetConventions } from './tools/get-conventions.js';
import { registerGetFindings } from './tools/get-findings.js';
import { registerListAgents } from './tools/list-agents.js';
import { registerRunAgentOnPr } from './tools/run-agent-on-pr.js';

/**
 * Composition root (plan decision 8): builds the api-client ONCE and hands it
 * (with `config`) to every tool factory. No module below this one reads
 * `process.env` or touches `fetch` directly.
 *
 * stdout is JSON-RPC only — nothing here (or below) may `console.log`;
 * diagnostics go through `config.log`, which writes to stderr and only when
 * DEVDIGEST_MCP_LOG=1.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const api = createApiClient(config);

  const server = new McpServer(
    { name: 'devdigest-mcp', version: '0.0.0' },
    {
      instructions:
        'Local stdio bridge to a running DevDigest API — discover agents, run a review on a pull request and wait for its findings, and read stored findings/conventions.',
    },
  );

  registerListAgents(server, { api });
  registerRunAgentOnPr(server, { api, config });
  registerGetFindings(server, { api });
  registerGetConventions(server, { api });
  registerGetBlastRadius(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  config.log('devdigest-mcp connected over stdio');
}

main().catch((err) => {
  // stderr only — see the module doc comment above.
  console.error('[devdigest-mcp] fatal:', err);
  process.exit(1);
});
