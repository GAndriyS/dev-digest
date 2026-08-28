/* api.ts — typed fetch client for the F1 Fastify engine (localhost:3001).
   All hooks build on `apiFetch`. Errors are normalized to ApiError so the
   error-UX taxonomy (toast/inline/full-screen) can branch on status. */

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001";

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function rawFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        // Only declare a JSON body when one is actually sent — otherwise a
        // body-less POST/PUT (e.g. refresh, reindex) trips Fastify's "Body
        // cannot be empty when content-type is application/json". Tour
        // generate is NOT body-less: it always sends `{ locale }` (A7,
        // SPEC-03) so the server has a language to write the tour in.
        ...(init?.body != null ? { "content-type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch (e) {
    // network failure / API down → full-screen error candidate
    throw new ApiError(
      `Cannot reach the DevDigest engine at ${API_BASE}. Is the API running?`,
      0,
      "network_error",
      e
    );
  }
}

async function errorFrom(res: Response): Promise<ApiError> {
  let code: string | undefined;
  let message = `${res.status} ${res.statusText}`;
  let details: unknown;
  try {
    const body = await res.json();
    if (body?.error) {
      code = body.error.code;
      message = body.error.message ?? message;
      details = body.error.details;
    }
  } catch {
    /* non-JSON error body */
  }
  return new ApiError(message, res.status, code, details);
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await rawFetch(path, init);
  if (!res.ok) throw await errorFrom(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Like `apiFetch`, but also returns the HTTP status — for the rare endpoint
 * where a 2xx success is itself status-discriminated (e.g.
 * `POST /findings/:id/eval-case`: 201 case just created vs 200 case already
 * existed, identical body either way — L06 AC-6). Error handling is identical
 * to `apiFetch`; only the success path keeps the status instead of discarding
 * it. Reuses the same `rawFetch`/error-mapping so the two never drift.
 */
export async function apiFetchWithStatus<T>(
  path: string,
  init?: RequestInit
): Promise<{ data: T; status: number }> {
  const res = await rawFetch(path, init);
  if (!res.ok) throw await errorFrom(res);
  const data = res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  return { data, status: res.status };
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => apiFetch<T>(path, { method: "DELETE" }),
};
