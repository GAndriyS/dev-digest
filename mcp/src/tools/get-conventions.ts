import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../lib/api-client.js';
import { toErrorResult } from '../lib/errors.js';
import { resolveRepo } from '../lib/resolve.js';
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

        const conventions: ConventionSummary[] = filtered.map((c) => ({
          category: c.category,
          rule: c.rule,
          evidence: c.evidence_line != null ? `${c.evidence_path}:${c.evidence_line}` : c.evidence_path,
          confidence: c.confidence,
          status: c.status,
        }));

        const message =
          conventions.length === 0 && args.status === 'accepted'
            ? 'No accepted conventions for this repo. Call again with status:"pending" to see unratified candidates, or run the conventions extractor in the DevDigest studio.'
            : undefined;

        const payload = GetConventionsOutput.parse({
          repo: repo.full_name,
          count: conventions.length,
          conventions,
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
