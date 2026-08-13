import type {
  Agent,
  ApiErrorBody,
  BlastRadius,
  ConventionCandidate,
  PrMeta,
  Repo,
  ReviewRecord,
  ReviewRunTarget,
  RunSummary,
} from '@devdigest/shared';
import type { Config } from '../config.js';
import { apiError, apiUnreachableError, rateLimitedError } from './errors.js';

/**
 * The single module that owns `fetch` (plan decision 8). Every other module
 * — resolve/poll/shape, the tool factories — takes this object at the
 * construction seam and never touches the network itself, so tests can
 * substitute a fake `ApiClient` instead of stubbing global `fetch` everywhere;
 * only this module's own tests stub `fetch`.
 *
 * `import type` only from `@devdigest/shared` — these are type positions, so
 * nothing here resolves the alias (and pulls in a second zod) at runtime.
 */
export interface ApiClient {
  listRepos(): Promise<Repo[]>;
  listPulls(repoId: string): Promise<PrMeta[]>;
  listAgents(): Promise<Agent[]>;
  startReview(prId: string, body: { agentId?: string; all?: boolean }): Promise<ReviewRunTarget[]>;
  listRuns(prId: string): Promise<RunSummary[]>;
  listReviews(prId: string): Promise<ReviewRecord[]>;
  listConventions(repoId: string): Promise<ConventionCandidate[]>;
  getBlastRadius(prId: string): Promise<BlastRadius>;
}

function isApiErrorBody(json: unknown): json is ApiErrorBody {
  if (typeof json !== 'object' || json === null || !('error' in json)) return false;
  const error = (json as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return typeof code === 'string' && typeof message === 'string';
}

export function createApiClient(config: Config): ApiClient {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${config.apiUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(config.requestTimeoutMs),
        headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
      });
    } catch (err) {
      config.log('fetch failed', path, err);
      throw apiUnreachableError(config.apiUrl);
    }

    if (res.status === 429) throw rateLimitedError();

    if (!res.ok) {
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = undefined;
      }
      if (isApiErrorBody(body)) {
        throw apiError(res.status, body.error.code, body.error.message);
      }
      throw apiError(res.status, 'unknown_error', res.statusText || `HTTP ${res.status}`);
    }

    return (await res.json()) as T;
  }

  return {
    listRepos: () => request<Repo[]>('/repos'),
    listPulls: (repoId) => request<PrMeta[]>(`/repos/${repoId}/pulls`),
    listAgents: () => request<Agent[]>('/agents'),
    startReview: async (prId, body) => {
      const res = await request<{ runs: ReviewRunTarget[] }>(`/pulls/${prId}/review`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return res.runs;
    },
    listRuns: (prId) => request<RunSummary[]>(`/pulls/${prId}/runs`),
    listReviews: (prId) => request<ReviewRecord[]>(`/pulls/${prId}/reviews`),
    listConventions: (repoId) => request<ConventionCandidate[]>(`/repos/${repoId}/conventions`),
    getBlastRadius: (prId) => request<BlastRadius>(`/pulls/${prId}/blast`),
  };
}
