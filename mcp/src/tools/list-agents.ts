import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../lib/api-client.js';
import { toErrorResult } from '../lib/errors.js';
import { truncateText, truncateToCharacterLimit } from '../lib/shape.js';
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
        // Agents are configuration, so this list is short in practice and gets
        // no pagination knob — but "short in practice" is not a bound, and the
        // CHARACTER_LIMIT rule holds for every tool, not just the ones with an
        // obvious way to overflow.
        const { items: page, truncated } = truncateToCharacterLimit(summaries);
        const dropped = summaries.length - page.length;
        const message = truncated
          ? `Response was capped — ${dropped} more agent(s) not shown.${
              args.enabled_only ? '' : ' Call again with enabled_only:true to narrow the list.'
            }`
          : undefined;

        const payload = ListAgentsOutput.parse({
          count: page.length,
          agents: page,
          ...(truncated ? { truncated: true } : {}),
          ...(message ? { message } : {}),
        });
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
