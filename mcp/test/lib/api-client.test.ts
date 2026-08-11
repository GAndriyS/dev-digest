import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { createApiClient } from '../../src/lib/api-client.js';

/**
 * The only test file in the package that stubs global `fetch` (plan decision
 * 8) — `lib/api-client.ts` is the single module that owns it.
 */
function jsonResponse(body: unknown, init: { status?: number; statusText?: string } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    headers: { 'content-type': 'application/json' },
  });
}

const config = loadConfig({ DEVDIGEST_API_URL: 'http://127.0.0.1:3001' } as NodeJS.ProcessEnv);

describe('createApiClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GETs and parses a successful response', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([{ id: 'r1' }]));
    vi.stubGlobal('fetch', fetchMock);

    const api = createApiClient(config);
    const repos = await api.listRepos();

    expect(repos).toEqual([{ id: 'r1' }]);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3001/repos',
      expect.objectContaining({ headers: expect.objectContaining({ 'content-type': 'application/json' }) }),
    );
  });

  it('throws an onward-leading error when the network call itself fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );

    const api = createApiClient(config);
    await expect(api.listRepos()).rejects.toThrow(/start it with .\/scripts\/dev\.sh/i);
  });

  it('throws a wait-a-minute error on 429', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, { status: 429 })));

    const api = createApiClient(config);
    await expect(api.listRepos()).rejects.toThrow(/rate limit/i);
  });

  it('decodes the structured ApiErrorBody envelope on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ error: { code: 'not_found', message: 'Repo not found' } }, { status: 404 }),
      ),
    );

    const api = createApiClient(config);
    await expect(api.listRepos()).rejects.toThrow(/Repo not found/);
  });

  it('falls back to statusText when the error body is not the expected envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ oops: true }, { status: 500, statusText: 'Server Error' })),
    );

    const api = createApiClient(config);
    await expect(api.listRepos()).rejects.toThrow(/Server Error/);
  });

  it('posts a review start and returns the started run targets', async () => {
    const runs = [{ run_id: 'run-1', agent_id: 'agent-1', agent_name: 'Reviewer' }];
    const fetchMock = vi.fn(async () => jsonResponse({ pr_id: 'pr-1', runs, reviews: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const api = createApiClient(config);
    const started = await api.startReview('pr-1', { all: true });

    expect(started).toEqual(runs);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init).toMatchObject({ method: 'POST', body: JSON.stringify({ all: true }) });
  });
});
