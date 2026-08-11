/**
 * Hard cap on a tool's rendered text summary. Keeps a large findings/agents
 * dump from blowing an agent's context in one call — pagination (get_findings
 * `limit`/`offset`) is the intended way past it, this is the backstop.
 */
export const CHARACTER_LIMIT = 25_000;

/**
 * Poll-loop backoff (risk noted in the plan: "poll budget vs 120/min global
 * limit"). The first minute of a run polls at `pollIntervalMs`; after that the
 * loop backs off to this wider interval so a long review doesn't compete with
 * the API's global rate limit.
 */
export const POLL_BACKOFF_AFTER_MS = 60_000;
export const POLL_BACKOFF_INTERVAL_MS = 5_000;

export const DEFAULT_FINDINGS_LIMIT = 20;
export const MAX_FINDINGS_LIMIT = 100;
export const DEFAULT_CONVENTIONS_LIMIT = 50;
