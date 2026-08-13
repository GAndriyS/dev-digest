import type { RunSummary } from '@devdigest/shared';
import { POLL_BACKOFF_AFTER_MS, POLL_BACKOFF_INTERVAL_MS } from '../constants.js';
import type { ApiClient } from './api-client.js';
import { McpToolError, RateLimitedError, rateLimitedWhilePollingError } from './errors.js';

export type PollOutcome = 'completed' | 'partial' | 'timeout';

export interface PollResult {
  outcome: PollOutcome;
  /** Final known state of exactly the started runs, in `startedRunIds` order. */
  runs: RunSummary[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll `GET /pulls/:id/runs` until every started run leaves `running` (plan
 * decision/step 5). `POST /pulls/:id/review` returns immediately with
 * `reviews: []` always (fire-and-forget) and SSE has no terminal event
 * (verified API facts) — polling the run list is the only correct way to
 * learn a review actually finished.
 *
 * Outcomes:
 *  - `completed` — every started run left `running` and all are `done`.
 *  - `partial`   — every started run left `running` but at least one is not
 *                  `done` (`failed`/`cancelled`); a bad agent does not hide
 *                  the others' results.
 *  - `timeout`   — the wait cap was hit before every run left `running`. This
 *                  is a structured result, not a thrown error — the caller's
 *                  next call (`get_findings`) is named in the tool's message.
 *
 * `startedRunIds` must be non-empty: an empty set satisfies "every run is
 * terminal" on the first tick and returns `completed` immediately. The caller
 * (`run_agent_on_pr`) rejects that case before getting here — a review that
 * never started is not a review that found nothing.
 *
 * Backs off from `pollIntervalMs` to a wider interval after the first minute
 * so a long-running review doesn't compete with the API's global rate limit.
 *
 * An API error mid-poll is a MISSED TICK, not a failure: by this point the
 * review is already running and already paid for. Aborting would surface an
 * error whose only sensible next step is `run_agent_on_pr` again — a second
 * paid review of the same PR. A 429 is the likely one (the API's 120/min limit
 * is shared with the studio UI, so a human clicking around can trip it), but
 * the same reasoning covers a restarting API. The loop waits out the backoff
 * and only surfaces the error if it is still failing at the deadline.
 */
export async function pollRuns(
  api: ApiClient,
  prId: string,
  startedRunIds: string[],
  opts: { pollIntervalMs: number; runTimeoutMs: number },
): Promise<PollResult> {
  const startedAt = Date.now();
  const deadline = startedAt + opts.runTimeoutMs;

  /** Last known state, so a failed tick at the deadline still reports it. */
  let started: RunSummary[] = [];
  let lastTickError: McpToolError | null = null;

  while (true) {
    try {
      const all = await api.listRuns(prId);
      const byId = new Map(all.map((r) => [r.run_id, r]));
      started = startedRunIds
        .map((id) => byId.get(id))
        .filter((r): r is RunSummary => r !== undefined);
      lastTickError = null;

      const everyRunSeen = started.length === startedRunIds.length;
      const everyRunTerminal = everyRunSeen && started.every((r) => r.status !== 'running');

      if (everyRunTerminal) {
        const outcome: PollOutcome = started.every((r) => r.status === 'done')
          ? 'completed'
          : 'partial';
        return { outcome, runs: started };
      }
    } catch (err) {
      // Any API-level failure after the run started is a MISSED TICK, not a
      // verdict: the review is already running and already paid for. Only a
      // non-API error (a bug here) is allowed to escape.
      if (!(err instanceof McpToolError)) throw err;
      lastTickError = err;
    }

    const now = Date.now();
    if (now >= deadline) {
      // The last tick failed, so the run's real state is unknown — it may well
      // have finished behind the error. Report that instead of a plain
      // timeout, with a message that never says "run the review again".
      if (lastTickError instanceof RateLimitedError) throw rateLimitedWhilePollingError();
      if (lastTickError) throw lastTickError; // e.g. API down: names ./scripts/dev.sh
      return { outcome: 'timeout', runs: started };
    }

    const elapsed = now - startedAt;
    // A failed tick (429 above all) is never retried at the fast interval.
    const interval =
      lastTickError || elapsed >= POLL_BACKOFF_AFTER_MS
        ? POLL_BACKOFF_INTERVAL_MS
        : opts.pollIntervalMs;
    await sleep(Math.max(0, Math.min(interval, deadline - now)));
  }
}
