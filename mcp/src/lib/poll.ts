import type { RunSummary } from '@devdigest/shared';
import { POLL_BACKOFF_AFTER_MS, POLL_BACKOFF_INTERVAL_MS } from '../constants.js';
import type { ApiClient } from './api-client.js';

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
 * Backs off from `pollIntervalMs` to a wider interval after the first minute
 * so a long-running review doesn't compete with the API's global rate limit.
 */
export async function pollRuns(
  api: ApiClient,
  prId: string,
  startedRunIds: string[],
  opts: { pollIntervalMs: number; runTimeoutMs: number },
): Promise<PollResult> {
  const startedAt = Date.now();
  const deadline = startedAt + opts.runTimeoutMs;

  while (true) {
    const all = await api.listRuns(prId);
    const byId = new Map(all.map((r) => [r.run_id, r]));
    const started = startedRunIds
      .map((id) => byId.get(id))
      .filter((r): r is RunSummary => r !== undefined);

    const everyRunSeen = started.length === startedRunIds.length;
    const everyRunTerminal = everyRunSeen && started.every((r) => r.status !== 'running');

    if (everyRunTerminal) {
      const outcome: PollOutcome = started.every((r) => r.status === 'done') ? 'completed' : 'partial';
      return { outcome, runs: started };
    }

    const now = Date.now();
    if (now >= deadline) {
      return { outcome: 'timeout', runs: started };
    }

    const elapsed = now - startedAt;
    const interval = elapsed >= POLL_BACKOFF_AFTER_MS ? POLL_BACKOFF_INTERVAL_MS : opts.pollIntervalMs;
    await sleep(Math.max(0, Math.min(interval, deadline - now)));
  }
}
