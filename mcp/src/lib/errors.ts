/**
 * Errors this package raises. Every message NAMES THE NEXT CALL (plan
 * decision: "errors that name the next call") — the reader on the other end
 * is a coding agent picking its next tool call, not a human reading a stack
 * trace, so "not found" alone is a dead end.
 *
 * `McpToolError` is caught at the tool-registration seam (src/tools/*.ts) and
 * turned into `{content:[{type:'text', text}], isError:true}` — never thrown
 * across the MCP boundary raw.
 */
export class McpToolError extends Error {}

/**
 * A 429 from the API. Its own class because `pollRuns` must tell it apart from
 * every other failure: mid-poll the review is ALREADY running and paid for, so
 * a rate limit there is a missed tick to retry, not a reason to abort and send
 * the caller back to `run_agent_on_pr` (which would start a second review).
 */
export class RateLimitedError extends McpToolError {}

export function apiUnreachableError(apiUrl: string): McpToolError {
  return new McpToolError(
    `Could not reach the DevDigest API at ${apiUrl}. Start it with ./scripts/dev.sh, then retry.`,
  );
}

export function repoNotFoundError(repo: string, knownRepos: string[]): McpToolError {
  const list = knownRepos.length > 0 ? knownRepos.join(', ') : '(no repos imported yet)';
  return new McpToolError(`No imported repo matches "${repo}". Imported repos: ${list}.`);
}

export function prNotFoundError(repo: string, pr: number, knownNumbers: number[]): McpToolError {
  const list = knownNumbers.length > 0 ? knownNumbers.join(', ') : '(no pull requests imported)';
  return new McpToolError(
    `Repo "${repo}" has no pull request #${pr}. Known PR numbers: ${list}.`,
  );
}

export function prMissingIdError(repo: string, pr: number): McpToolError {
  return new McpToolError(
    `Pull request #${pr} in "${repo}" has no internal id yet (not fully imported). ` +
      `Open it once in the DevDigest UI, or retry shortly once the sync finishes.`,
  );
}

export function agentNotFoundError(agent: string, knownAgents: string[]): McpToolError {
  const list = knownAgents.length > 0 ? knownAgents.join(', ') : '(no agents configured)';
  return new McpToolError(`No agent named "${agent}". Call list_agents to see valid names: ${list}.`);
}

export function rateLimitedError(): RateLimitedError {
  return new RateLimitedError(
    'DevDigest API rate limit hit. Wait about a minute, then retry the same call.',
  );
}

/**
 * The 429 variant for a review that is already running: naming
 * `run_agent_on_pr` here would tell the caller to pay for a second review of
 * the same PR.
 */
export function rateLimitedWhilePollingError(): RateLimitedError {
  return new RateLimitedError(
    'DevDigest API rate limit hit while waiting for a review that is already running. ' +
      'Do not start another run — call get_findings for this PR in a minute to collect it.',
  );
}

export function apiError(status: number, code: string, message: string): McpToolError {
  return new McpToolError(`DevDigest API error (${status} ${code}): ${message}`);
}

/**
 * Every tool's catch block funnels here (plan decision 6): `isError:true` and
 * `structuredContent` OMITTED — an error object would fail the tool's own
 * `outputSchema` validation at the transport layer.
 */
export function toErrorResult(err: unknown): {
  content: [{ type: 'text'; text: string }];
  isError: true;
} {
  const text = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text', text }], isError: true };
}
