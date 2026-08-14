import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../lib/api-client.js';
import { toErrorResult } from '../lib/errors.js';
import { resolvePr, resolveRepo } from '../lib/resolve.js';
import {
  aggregateFindings,
  countSeverities,
  sortFindings,
  toFindingSummary,
  truncateToCharacterLimit,
} from '../lib/shape.js';
import { GetFindingsInput, GetFindingsOutput } from '../schemas.js';

const DESCRIPTION =
  "Returns the review findings already recorded for a pull request — aggregated across every review run, dismissed findings excluded. Free: reads stored results without starting a new review. Call it to read results, after a `run_agent_on_pr` timeout, or to page through a large set; if the PR has never been reviewed it returns zero findings — run `run_agent_on_pr` first.";

export function registerGetFindings(server: McpServer, deps: { api: ApiClient }): void {
  server.registerTool(
    'get_findings',
    {
      title: 'Get findings',
      description: DESCRIPTION,
      inputSchema: GetFindingsInput,
      outputSchema: GetFindingsOutput.shape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        const repo = await resolveRepo(deps.api, args.repo);
        const { pr, prId } = await resolvePr(deps.api, repo, args.pr);

        const reviews = await deps.api.listReviews(prId);
        // Aggregated across every review (decision 2) — `counts` always shows
        // the full severity breakdown regardless of the `severity` filter, so
        // a caller filtering to CRITICAL still learns what else exists.
        const all = sortFindings(aggregateFindings(reviews));
        const counts = countSeverities(all.map(({ finding }) => finding));

        const filtered = args.severity ? all.filter((f) => f.finding.severity === args.severity) : all;
        const total = filtered.length;
        const page = filtered.slice(args.offset, args.offset + args.limit);
        const shapedPage = page.map(({ finding, agent }) => toFindingSummary(finding, agent));
        const { items, truncated } = truncateToCharacterLimit(shapedPage);

        let message: string | undefined;
        if (all.length === 0) {
          message = 'This PR has never been reviewed (or every review found nothing). Call run_agent_on_pr to generate findings.';
        } else if (total === 0 && args.severity) {
          message = `No ${args.severity} findings; ${all.length} finding(s) of other severities exist — omit severity to see them.`;
        } else if (items.length === 0 && total > 0) {
          message = `offset ${args.offset} is past the end (total ${total}) — call again with a smaller offset.`;
        }

        const payload = GetFindingsOutput.parse({
          pr: `${repo.full_name}#${pr.number}`,
          total,
          returned: items.length,
          offset: args.offset,
          ...(args.offset + items.length < total ? { next_offset: args.offset + items.length } : {}),
          counts,
          findings: items,
          ...(truncated ? { truncated: true } : {}),
          ...(message ? { message } : {}),
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: `${payload.pr}: ${payload.returned} of ${payload.total} finding(s) returned.`,
            },
          ],
          structuredContent: payload,
        };
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );
}
