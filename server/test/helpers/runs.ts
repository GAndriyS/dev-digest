import * as t from '../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import type { PgFixture } from './pg.js';

/**
 * `runReview` is fire-and-forget: the POST returns runIds immediately and each
 * agent's review is persisted in the background (the client subscribes to SSE).
 * Tests that assert on persisted reviews/findings/traces must first wait for the
 * background runs to finish. This polls `agent_runs` until every row for the PR
 * reaches a terminal status (done / failed / cancelled).
 */
const TERMINAL = new Set(['done', 'failed', 'cancelled']);

export async function waitForPrRuns(
  db: PgFixture['handle']['db'],
  prId: string,
  opts: { expected?: number; timeoutMs?: number } = {},
): Promise<Array<typeof t.agentRuns.$inferSelect>> {
  const { expected, timeoutMs = 10_000 } = opts;
  const start = Date.now();
  for (;;) {
    const runs = await db.select().from(t.agentRuns).where(eq(t.agentRuns.prId, prId));
    const terminal = runs.filter((r) => TERMINAL.has(r.status ?? ''));
    // With an explicit `expected`, wait until that many runs finish (ignores any
    // extra rows, e.g. a trifecta scan). Otherwise wait for all rows to settle.
    const done =
      expected != null
        ? terminal.length >= expected
        : runs.length > 0 && terminal.length === runs.length;
    if (done) return runs;
    if (Date.now() - start > timeoutMs) return runs;
    await new Promise((r) => setTimeout(r, 25));
  }
}

/**
 * `completeAgentRun` (which flips `agent_runs.status` to terminal —
 * `waitForPrRuns` above polls exactly that) runs tens of lines before
 * `saveRunTrace` persists the `run_traces` row. A test that waits only on
 * `waitForPrRuns` and then reads `GET /runs/:id/trace` can win that race and
 * read the route's row-shaped default instead of the real trace
 * (`server/INSIGHTS.md` 2026-08-18, Recurring Errors). Poll the `run_traces`
 * row itself before asserting on `trace.log`/`trace.specs_read` — do not
 * retry the assertion instead, which just moves the same race into the test.
 */
export async function waitForRunTrace(
  db: PgFixture['handle']['db'],
  runId: string,
  opts: { timeoutMs?: number } = {},
): Promise<void> {
  const { timeoutMs = 10_000 } = opts;
  const start = Date.now();
  for (;;) {
    const [row] = await db.select().from(t.runTraces).where(eq(t.runTraces.runId, runId));
    if (row) return;
    if (Date.now() - start > timeoutMs) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}
