import { describe, it, expect } from 'vitest';
import { GitHubRepoAvailability } from '../src/modules/pulls/github-availability.js';
import { errSummary } from '../src/platform/errors.js';
import { httpStatusOf } from '../src/platform/resilience.js';

describe('GitHubRepoAvailability', () => {
  /** Controllable clock so TTL expiry is tested without waiting on real time. */
  function atClock(startMs = 0) {
    let now = startMs;
    const cache = new GitHubRepoAvailability(10 * 60 * 1000, () => now);
    return { cache, advance: (ms: number) => (now += ms) };
  }

  it('reports an unseen repo as available', () => {
    const { cache } = atClock();
    expect(cache.isKnownMissing('repo-1')).toBe(false);
  });

  it('suppresses a repo once marked missing', () => {
    const { cache } = atClock();
    cache.markMissing('repo-1');
    expect(cache.isKnownMissing('repo-1')).toBe(true);
  });

  it('scopes the suppression to the repo that 404d', () => {
    const { cache } = atClock();
    cache.markMissing('repo-1');
    expect(cache.isKnownMissing('repo-2')).toBe(false);
  });

  it('re-probes once the TTL expires', () => {
    const { cache, advance } = atClock();
    cache.markMissing('repo-1');
    advance(10 * 60 * 1000 - 1);
    expect(cache.isKnownMissing('repo-1')).toBe(true);
    advance(1);
    expect(cache.isKnownMissing('repo-1')).toBe(false);
  });

  it('clears the suppression as soon as a call succeeds', () => {
    const { cache } = atClock();
    cache.markMissing('repo-1');
    cache.markPresent('repo-1');
    expect(cache.isKnownMissing('repo-1')).toBe(false);
  });
});

describe('httpStatusOf', () => {
  it('reads the status off every client shape', () => {
    expect(httpStatusOf(Object.assign(new Error('octokit'), { status: 404 }))).toBe(404);
    expect(httpStatusOf(Object.assign(new Error('fastify'), { statusCode: 422 }))).toBe(422);
    expect(httpStatusOf(Object.assign(new Error('fetch'), { response: { status: 500 } }))).toBe(500);
  });

  it('returns undefined for a non-HTTP failure', () => {
    expect(httpStatusOf(new Error('socket hang up'))).toBeUndefined();
  });
});

describe('errSummary', () => {
  it('keeps only the fields we act on', () => {
    const err = Object.assign(new Error('Not Found'), {
      status: 404,
      // What Octokit actually hangs off its errors — none of it belongs in a log.
      response: { headers: { 'x-ratelimit-remaining': '4971' }, data: { message: 'Not Found' } },
      request: { url: 'https://api.github.com/repos/acme/payments-api/pulls' },
    });
    expect(errSummary(err)).toEqual({ name: 'Error', status: 404, message: 'Not Found' });
  });

  it('keeps a network error code when there is no HTTP status', () => {
    const err = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    expect(errSummary(err)).toEqual({
      name: 'Error',
      code: 'ECONNREFUSED',
      message: 'connect ECONNREFUSED',
    });
  });

  it('stringifies a non-Error throw', () => {
    expect(errSummary('boom')).toEqual({ message: 'boom' });
  });

  it('stays small next to the raw error', () => {
    const err = Object.assign(new Error('Not Found'), {
      status: 404,
      response: { headers: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`h${i}`, 'x'.repeat(60)])) },
    });
    const summarized = JSON.stringify(errSummary(err)).length;
    const raw = JSON.stringify({ message: err.message, ...err }).length;
    expect(summarized).toBeLessThan(raw / 10);
  });
});
