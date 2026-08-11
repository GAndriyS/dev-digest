import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../lib/api-client.js';
import { toErrorResult } from '../lib/errors.js';
import { resolveRepo } from '../lib/resolve.js';
import { truncateText, truncateToCharacterLimit } from '../lib/shape.js';
import { MAX_TEXT_CHARS } from '../constants.js';
import { GetConventionsInput, GetConventionsOutput, type ConventionSummary } from '../schemas.js';

const DESCRIPTION =
  "Returns the repository's coding conventions extracted by DevDigest's conventions extractor. By default only accepted conventions — pass status \"pending\" to see unratified candidates. Repo-level, not PR-level: for review findings on a pull request use `get_findings`.";

export function registerGetConventions(server: McpServer, deps: { api: ApiClient }): void {
  server.registerTool(
    'get_conventions',
    {
      title: 'Get conventions',
      description: DESCRIPTION,
      inputSchema: GetConventionsInput,
      outputSchema: GetConventionsOutput.shape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        const repo = await resolveRepo(deps.api, args.repo);
        const candidates = await deps.api.listConventions(repo.id);
        // Un-extracted repo → [], not an error (verified API fact).
        const filtered = candidates.filter((c) => c.status === args.status).slice(0, args.limit);

        // `rule` is extractor (model) output with no length bound of its own,
        // and the page itself gets the same CHARACTER_LIMIT backstop the two
        // findings tools use — an uncapped tool is one call away from filling
        // the caller's context.
        const mapped: ConventionSummary[] = filtered.map((c) => ({
          category: c.category,
          rule: truncateText(c.rule, MAX_TEXT_CHARS),
          evidence: c.evidence_line != null ? `${c.evidence_path}:${c.evidence_line}` : c.evidence_path,
          confidence: c.confidence,
          status: c.status,
        }));
        const { items: conventions, truncated } = truncateToCharacterLimit(mapped);

        const message =
          conventions.length === 0 && args.status === 'accepted'
            ? 'No accepted conventions for this repo. Call again with status:"pending" to see unratified candidates, or run the conventions extractor in the DevDigest studio.'
            : truncated
              ? 'Response was capped — call again with a smaller limit to see the rest.'
              : undefined;

        const payload = GetConventionsOutput.parse({
          repo: repo.full_name,
          count: conventions.length,
          conventions,
          ...(truncated ? { truncated: true } : {}),
          ...(message ? { message } : {}),
        });

        return {
          content: [
            { type: 'text' as const, text: `${payload.repo}: ${payload.count} ${args.status} convention(s).` },
          ],
          structuredContent: payload,
        };
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );
}
