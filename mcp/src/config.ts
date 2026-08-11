import { z } from 'zod';

/**
 * Environment configuration, parsed once at startup (src/index.ts, the
 * composition root) and passed into tool factories as a plain object — no
 * module below this one reads `process.env` directly.
 *
 * `127.0.0.1`, never `localhost`, is the default: on Windows `localhost` can
 * resolve to `::1` where an unrelated project's API is listening, so a
 * `localhost` default would silently talk to the wrong server (root
 * INSIGHTS.md).
 */
const EnvSchema = z.object({
  DEVDIGEST_API_URL: z.string().url().default('http://127.0.0.1:3001'),
  DEVDIGEST_MCP_RUN_TIMEOUT_MS: z.coerce.number().int().positive().default(600_000),
  DEVDIGEST_MCP_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2_000),
  DEVDIGEST_MCP_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  DEVDIGEST_MCP_LOG: z.string().optional(),
});

export interface Config {
  apiUrl: string;
  runTimeoutMs: number;
  pollIntervalMs: number;
  requestTimeoutMs: number;
  /**
   * Diagnostics only — stdout is JSON-RPC and nothing else, so every
   * diagnostic goes to stderr, and only when DEVDIGEST_MCP_LOG=1. A stray
   * `console.log` here would corrupt the transport.
   */
  log: (...args: unknown[]) => void;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.parse(env);
  const logEnabled = parsed.DEVDIGEST_MCP_LOG === '1';
  return {
    apiUrl: parsed.DEVDIGEST_API_URL,
    runTimeoutMs: parsed.DEVDIGEST_MCP_RUN_TIMEOUT_MS,
    pollIntervalMs: parsed.DEVDIGEST_MCP_POLL_INTERVAL_MS,
    requestTimeoutMs: parsed.DEVDIGEST_MCP_REQUEST_TIMEOUT_MS,
    log: (...args: unknown[]) => {
      if (logEnabled) console.error('[devdigest-mcp]', ...args);
    },
  };
}
