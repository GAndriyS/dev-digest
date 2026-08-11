import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POLL_BACKOFF_AFTER_MS, POLL_BACKOFF_INTERVAL_MS } from '../../src/constants.js';
import { rateLimitedError } from '../../src/lib/errors.js';
import { pollRuns } from '../../src/lib/poll.js';
import { makeFakeApiClient } from '../helpers/fake-api-client.js';
import { makeRunSummary } from '../helpers/fixtures.js';

describe('pollRuns', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves completed once every started run leaves running as done', async () => {
    let call = 0;
    const api = makeFakeApiClient({
      listRuns: async () => {
        call += 1;
        return [makeRunSummary({ run_id: 'run-1', status: call < 2 ? 'running' : 'done' })];
      },
    });

    const promise = pollRuns(api, 'pr-1', ['run-1'], { pollIntervalMs: 10, runTimeoutMs: 1_000 });
    await vi.advanceTimersByTimeAsync(20);
    const result = await promise;

    expect(result.outcome).toBe('completed');
    expect(result.runs[0]!.status).toBe('done');
  });

  // Security review, WARNING: mid-poll the review is already running and
  // already paid for, and the API's 120/min limit is shared with the studio UI
  // — a human clicking around can trip it. Aborting here would hand the caller
  // an error whose only sensible next step is run_agent_on_pr again, i.e. a
  // second paid review of the same PR.
  it('treats a 429 mid-poll as a missed tick and still returns the finished run', async () => {
    let call = 0;
    const api = makeFakeApiClient({
      listRuns: async () => {
        call += 1;
        if (call === 1) throw rateLimitedError();
        return [makeRunSummary({ run_id: 'run-1', status: 'done' })];
      },
    });

    const promise = pollRuns(api, 'pr-1', ['run-1'], { pollIntervalMs: 10, runTimeoutMs: 60_000 });
    await vi.advanceTimersByTimeAsync(POLL_BACKOFF_INTERVAL_MS + 10);
    const result = await promise;

    expect(result.outcome).toBe('completed');
    expect(call).toBe(2);
  });

  it('names get_findings, not another run, when still rate limited at the deadline', async () => {
    const api = makeFakeApiClient({
      listRuns: async () => {
        throw rateLimitedError();
      },
    });

    const promise = pollRuns(api, 'pr-1', ['run-1'], { pollIntervalMs: 10, runTimeoutMs: 50 });
    const assertion = expect(promise).rejects.toThrow(/get_findings/);
    await vi.advanceTimersByTimeAsync(200);
    await assertion;
  });

  it('resolves partial when a started run is terminal but not done — a bad agent does not hide the others', async () => {
    const api = makeFakeApiClient({
      listRuns: async () => [
        makeRunSummary({ run_id: 'run-1', status: 'done' }),
        makeRunSummary({ run_id: 'run-2', status: 'failed', agent_name: 'Broken' }),
      ],
    });

    const result = await pollRuns(api, 'pr-1', ['run-1', 'run-2'], {
      pollIntervalMs: 10,
      runTimeoutMs: 1_000,
    });
    expect(result.outcome).toBe('partial');
  });

  it('resolves timeout — not a thrown error — when the cap is hit before every run leaves running', async () => {
    const api = makeFakeApiClient({
      listRuns: async () => [makeRunSummary({ run_id: 'run-1', status: 'running' })],
    });

    const promise = pollRuns(api, 'pr-1', ['run-1'], { pollIntervalMs: 10, runTimeoutMs: 25 });
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result.outcome).toBe('timeout');
  });

  it('backs off to the wider interval after the first minute (rate-limit budget)', async () => {
    const api = makeFakeApiClient({
      listRuns: vi.fn(async () => [makeRunSummary({ run_id: 'run-1', status: 'running' })]),
    });

    const promise = pollRuns(api, 'pr-1', ['run-1'], {
      pollIntervalMs: 1_000,
      runTimeoutMs: POLL_BACKOFF_AFTER_MS + 3 * POLL_BACKOFF_INTERVAL_MS,
    });

    await vi.advanceTimersByTimeAsync(POLL_BACKOFF_AFTER_MS);
    const callsAtBackoff = (api.listRuns as ReturnType<typeof vi.fn>).mock.calls.length;
    // ~1 call/second for the first minute.
    expect(callsAtBackoff).toBeGreaterThan(POLL_BACKOFF_AFTER_MS / 1_000 - 3);

    await vi.advanceTimersByTimeAsync(2 * POLL_BACKOFF_INTERVAL_MS);
    const callsAfterBackoff = (api.listRuns as ReturnType<typeof vi.fn>).mock.calls.length;
    // If it kept polling every 1s post-backoff this delta would be ~10; the
    // wider interval keeps it near 2.
    expect(callsAfterBackoff - callsAtBackoff).toBeLessThanOrEqual(3);

    await vi.runAllTimersAsync();
    await promise;
  });
});
