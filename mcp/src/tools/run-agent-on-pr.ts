import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config } from '../config.js';
import type { ApiClient } from '../lib/api-client.js';
import { noRunsStartedError, toErrorResult } from '../lib/errors.js';
import { pollRuns } from '../lib/poll.js';
import { resolveAgent, resolvePr, resolveRepo } from '../lib/resolve.js';
import {
  aggregateFindings,
  correlateRuns,
  countSeverities,
  sortFindings,
  toFindingSummary,
  truncateToCharacterLimit,
  worstScore,
  worstVerdict,
} from '../lib/shape.js';
import { RunAgentOnPrInput, RunAgentOnPrOutput } from '../schemas.js';

const DESCRIPTION =
  "Runs an AI review on a pull request and waits for it to finish, returning the verdict and findings in one call. Omit `agent` to run every enabled agent, or pass a name from `list_agents` to run one. Each call spends real LLM tokens and appends a new review to the PR's history — to read existing results, use `get_findings` instead. Reviews can take minutes; if the wait cap is hit, the result says so and `get_findings` collects the outcome later.";

/**
 * Result-not-operation (plan design principle 1): this tool starts the
 * review, polls until it finishes, and returns finished findings in one
 * call — a coding agent should not have to orchestrate start/poll/collect
 * itself.
 */
export function registerRunAgentOnPr(
  server: McpServer,
  deps: { api: ApiClient; config: Config },
): void {
  server.registerTool(
    'run_agent_on_pr',
    {
      title: 'Run agent on PR',
      description: DESCRIPTION,
      inputSchema: RunAgentOnPrInput,
      outputSchema: RunAgentOnPrOutput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const repo = await resolveRepo(deps.api, args.repo);
        const { prId } = await resolvePr(deps.api, repo, args.pr);

        const runBody = args.agent
          ? { agentId: (await resolveAgent(deps.api, args.agent)).id }
          : { all: true };
        const started = await deps.api.startReview(prId, runBody);
        const startedRunIds = started.map((r) => r.run_id);

        // Nothing started → nothing to poll: an empty id set is trivially
        // "every run terminal", so the loop would return `completed` at once
        // and the caller would read a review that never ran as a clean one.
        if (startedRunIds.length === 0) throw noRunsStartedError(repo.full_name, args.pr);

        const poll = await pollRuns(deps.api, prId, startedRunIds, {
          pollIntervalMs: deps.config.pollIntervalMs,
          runTimeoutMs: deps.config.runTimeoutMs,
        });

        // Correlate to the runs THIS call started (verified API fact: the
        // reviews read here span the PR's whole history via run_id).
        const reviews = await deps.api.listReviews(prId);
        const startedIdSet = new Set(startedRunIds);
        const startedReviews = reviews.filter((r) => r.run_id && startedIdSet.has(r.run_id));

        const agentsRun = correlateRuns(poll.runs, reviews);
        const aggregated = sortFindings(aggregateFindings(startedReviews));
        const counts = countSeverities(aggregated.map(({ finding }) => finding));
        const shaped = aggregated.map(({ finding, agent }) => toFindingSummary(finding, agent));
        const { items, truncated } = truncateToCharacterLimit(shaped);

        const verdict = worstVerdict(startedReviews.map((r) => r.verdict));
        const score = worstScore(startedReviews.map((r) => r.score));

        const payload = RunAgentOnPrOutput.parse({
          status: poll.outcome,
          verdict,
          score,
          counts,
          agents_run: agentsRun,
          findings: items,
          ...(truncated ? { truncated: true } : {}),
          ...(poll.outcome === 'timeout'
            ? {
                message:
                  'Wait cap hit before every run finished. Call get_findings for this PR once the review(s) complete.',
              }
            : {}),
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: `${payload.status} — verdict ${payload.verdict ?? 'n/a'}, ${payload.findings.length} finding(s) from ${payload.agents_run.length} agent(s).`,
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
