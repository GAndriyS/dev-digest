import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config } from '../config.js';
import type { ApiClient } from '../lib/api-client.js';
import { toErrorResult } from '../lib/errors.js';
import { pollRuns } from '../lib/poll.js';
import { resolveAgent, resolvePr, resolveRepo } from '../lib/resolve.js';
import {
  aggregateFindings,
  countSeverities,
  sortFindings,
  toFindingSummary,
  truncateToCharacterLimit,
  worstVerdict,
} from '../lib/shape.js';
import { RunAgentOnPrInput, RunAgentOnPrOutput, type AgentRunOutcome } from '../schemas.js';

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

        const poll = await pollRuns(deps.api, prId, startedRunIds, {
          pollIntervalMs: deps.config.pollIntervalMs,
          runTimeoutMs: deps.config.runTimeoutMs,
        });

        // Correlate to the runs THIS call started (verified API fact: the
        // reviews read here span the PR's whole history via run_id).
        const reviews = await deps.api.listReviews(prId);
        const reviewByRunId = new Map(reviews.map((r) => [r.run_id, r]));
        const startedIdSet = new Set(startedRunIds);
        const startedReviews = reviews.filter((r) => r.run_id && startedIdSet.has(r.run_id));

        // A failed run reports in `agents_run` rather than aborting the others.
        const agentsRun: AgentRunOutcome[] = poll.runs.map((run) => {
          const review = reviewByRunId.get(run.run_id);
          return {
            agent: run.agent_name ?? '(unknown agent)',
            status: run.status ?? 'unknown',
            verdict: review?.verdict ?? null,
            score: review?.score ?? null,
            findings_count: review ? review.findings.filter((f) => !f.dismissed_at).length : 0,
            ...(run.error ? { error: run.error } : {}),
          };
        });

        const aggregated = sortFindings(aggregateFindings(startedReviews));
        const counts = countSeverities(aggregated.map(({ finding }) => finding));
        const shaped = aggregated.map(({ finding, agent }) => toFindingSummary(finding, agent));
        const { items, truncated } = truncateToCharacterLimit(shaped);

        const verdict = worstVerdict(startedReviews.map((r) => r.verdict));
        // "Worst" score = the lowest among the agents that produced one — a
        // higher score is better (Review contract), so min is the pessimistic
        // read that matches the worst-of verdict.
        const scored = startedReviews.map((r) => r.score).filter((s): s is number => s != null);
        const score = scored.length > 0 ? Math.min(...scored) : null;

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
