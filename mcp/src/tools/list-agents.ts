import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../lib/api-client.js';
import { toErrorResult } from '../lib/errors.js';
import { truncateText } from '../lib/shape.js';
import { ListAgentsInput, ListAgentsOutput, type AgentSummary } from '../schemas.js';

const DESCRIPTION =
  "Lists the review agents configured in DevDigest, with each agent's name, provider and model. Call it to discover valid agent names before `run_agent_on_pr`, or to see what a run without an explicit agent would execute. Not for run results or findings — agents are configuration, not output.";

export function registerListAgents(server: McpServer, deps: { api: ApiClient }): void {
  server.registerTool(
    'list_agents',
    {
      title: 'List agents',
      description: DESCRIPTION,
      inputSchema: ListAgentsInput,
      outputSchema: ListAgentsOutput.shape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        const agents = await deps.api.listAgents();
        const filtered = args.enabled_only ? agents.filter((a) => a.enabled) : agents;
        const summaries: AgentSummary[] = filtered.map((a) => ({
          name: a.name,
          description: truncateText(a.description, 120),
          provider: a.provider,
          model: a.model,
          enabled: a.enabled,
          strategy: a.strategy,
          ci_fail_on: a.ci_fail_on,
        }));
        const payload = ListAgentsOutput.parse({ count: summaries.length, agents: summaries });
        return {
          content: [{ type: 'text' as const, text: `${payload.count} agent(s).` }],
          structuredContent: payload,
        };
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );
}
