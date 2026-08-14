import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../lib/api-client.js';
import { toErrorResult } from '../lib/errors.js';
import { resolvePr, resolveRepo } from '../lib/resolve.js';
import { toBlastSummary } from '../lib/shape.js';
import { GetBlastRadiusInput, GetBlastRadiusOutput } from '../schemas.js';

const DESCRIPTION =
  "Maps what else a PR's diff can reach: the symbols it declares, their callers, and the endpoints and crons downstream. Free static index read — no review, no model call. For what a review flagged, use `get_findings`.";

/**
 * Reads `GET /pulls/:id/blast`, which is a pure index read on the server.
 *
 * A thin or missing index is reported through `status` (+ `reason`) as a
 * SUCCESS, never as `isError`: "no caller depends on this" and "the index
 * could not tell" are different answers, and collapsing the second into an
 * error — or into an empty list — is how a caller ends up trusting a map that
 * was never built.
 */
export function registerGetBlastRadius(server: McpServer, deps: { api: ApiClient }): void {
  server.registerTool(
    'get_blast_radius',
    {
      title: 'Get blast radius',
      description: DESCRIPTION,
      inputSchema: GetBlastRadiusInput,
      outputSchema: GetBlastRadiusOutput.shape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        const repo = await resolveRepo(deps.api, args.repo);
        const { pr, prId } = await resolvePr(deps.api, repo, args.pr);

        const blast = await deps.api.getBlastRadius(prId);
        const shaped = toBlastSummary(blast);

        let message: string | undefined;
        if (blast.reason === 'no_changed_files') {
          // Not an index problem — pointing at re-indexing here would waste a
          // caller's next move.
          message =
            "This PR's changed files have not been imported yet, so there is nothing to trace. Re-read the pull request, then call get_blast_radius again.";
        } else if (blast.status === 'degraded') {
          message = `The repository index could not establish downstream impact (${
            blast.reason ?? 'no_data'
          }) — this is not the same as nothing depending on the change. Re-index the repository, then call get_blast_radius again.`;
        } else if (blast.status === 'partial') {
          message =
            'The repository index is only partially built, so callers or endpoints may be missing from this map.';
        } else if (shaped.changedSymbols === 0) {
          message =
            "No indexed symbol is declared in this PR's changed files — the diff touches no code the index tracks.";
        } else if (shaped.totalCallers === 0) {
          message = 'Nothing in the repository references the changed symbols.';
        }

        const payload = GetBlastRadiusOutput.parse({
          pr: `${repo.full_name}#${pr.number}`,
          status: blast.status,
          ...(blast.reason ? { reason: blast.reason } : {}),
          indexed_sha: blast.indexed_sha,
          changed_symbols: shaped.changedSymbols,
          total_callers: shaped.totalCallers,
          endpoints: shaped.endpoints,
          crons: shaped.crons,
          impacts: shaped.impacts,
          ...(shaped.truncated ? { truncated: true } : {}),
          ...(message ? { message } : {}),
        });

        return {
          content: [
            {
              type: 'text' as const,
              text:
                `${payload.pr}: ${payload.changed_symbols} changed symbol(s), ` +
                `${payload.total_callers} caller(s), ${payload.endpoints.length} endpoint(s), ` +
                `${payload.crons.length} cron(s) — index ${payload.status}.`,
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
