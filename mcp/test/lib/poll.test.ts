import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POLL_BACKOFF_AFTER_MS, POLL_BACKOFF_INTERVAL_MS } from '../../src/constants.js';
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
