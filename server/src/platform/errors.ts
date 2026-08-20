/**
 * Domain error taxonomy + structured API error envelope. The UX taxonomy
 * (toast/inline/full-screen) is the frontend's concern; the API returns a
 * stable structured body (ApiErrorBody): { error: { code, message, details } }.
 */

import { httpStatusOf } from './resilience.js';

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found', details?: unknown) {
    super('not_found', message, 404, details);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) {
    super('validation_error', message, 422, details);
  }
}

export class ExternalServiceError extends AppError {
  constructor(message: string, details?: unknown) {
    super('external_service_error', message, 502, details);
  }
}

export class ConfigError extends AppError {
  constructor(message: string, details?: unknown) {
    super('config_error', message, 500, details);
  }
}

/** Wire code the client keys its disabled "run/generate" actions off. */
export const NO_PROVIDER_KEY_CODE = 'no_provider_key';

/**
 * 409, not 500 — "no key configured yet" is a UI state, not a server fault.
 * One class for every LLM feature (conventions, skills evals, onboarding) so
 * the code, status and message shape cannot drift per module; `action`
 * finishes the sentence ("… add one in Settings to <action>.").
 */
export class NoProviderKeyError extends AppError {
  constructor(provider: string, action: string) {
    super(
      NO_PROVIDER_KEY_CODE,
      `No API key configured for provider "${provider}" — add one in Settings to ${action}.`,
      409,
      { provider },
    );
  }
}

/**
 * Compact an error for logging. Pino serializes a thrown object in full, and
 * Octokit hangs the entire request AND response — every header — off its
 * errors: one GitHub 404 is ~3KB of log. That is not free. The API's stdout is
 * a pipe under `pnpm dev`, and Node writes to pipes SYNCHRONOUSLY on Windows,
 * so a log consumer that stops draining blocks the whole process: the event
 * loop stalls before Fastify can even log `incoming request`, and the server
 * goes silent at 0% CPU while still holding the port.
 *
 * Use this for expected failures of external calls, where the status and the
 * message are all we act on. Keep the raw error for genuine bugs.
 */
export function errSummary(err: unknown): {
  name?: string;
  status?: number;
  code?: string;
  message: string;
} {
  const status = httpStatusOf(err);
  const code = (err as { code?: string })?.code;
  return {
    ...(err instanceof Error ? { name: err.name } : {}),
    ...(status != null ? { status } : {}),
    ...(code != null ? { code } : {}),
    message: err instanceof Error ? err.message : String(err),
  };
}
