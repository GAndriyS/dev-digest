import { vi } from 'vitest';
import type { ApiClient } from '../../src/lib/api-client.js';

/**
 * A fake `ApiClient` object substituted at the tool-factory seam (plan
 * decision 8) — every module above `lib/api-client.ts` takes this object,
 * never `fetch` itself, so tests never reach for `vi.mock` of a module path.
 */
export function makeFakeApiClient(overrides: Partial<ApiClient> = {}): ApiClient {
  // Every method is ALWAYS wrapped in `vi.fn`, including a caller-supplied
  // override — so `expect(api.x).toHaveBeenCalledWith(...)` works whether the
  // test passed a plain async function or its own `vi.fn`.
  return {
    listRepos: vi.fn(overrides.listRepos ?? (async () => [])),
    listPulls: vi.fn(overrides.listPulls ?? (async () => [])),
    listAgents: vi.fn(overrides.listAgents ?? (async () => [])),
    startReview: vi.fn(overrides.startReview ?? (async () => [])),
    listRuns: vi.fn(overrides.listRuns ?? (async () => [])),
    listReviews: vi.fn(overrides.listReviews ?? (async () => [])),
    listConventions: vi.fn(overrides.listConventions ?? (async () => [])),
  };
}
