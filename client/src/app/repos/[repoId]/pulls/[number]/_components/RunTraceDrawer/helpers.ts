import type { LogLine } from "@devdigest/ui";
import type { RunTrace } from "@devdigest/shared";

interface RawEvent {
  t: string;
  kind: string;
  msg: string;
}

/** Map run-bus events to the LiveLogStream LogLine shape. */
export function eventsToLog(events: RawEvent[]): LogLine[] {
  return events.map((e) => ({ t: e.t, k: e.kind as LogLine["k"], m: e.msg }));
}

/** Map a persisted trace's log to the LiveLogStream LogLine shape. */
export function traceLog(trace: RunTrace | undefined): LogLine[] {
  return trace?.log.map((l) => ({ t: l.t, k: l.kind as LogLine["k"], m: l.msg })) ?? [];
}

/** Seconds-formatted duration. */
export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Token in→out summary (e.g. "12k→1.5k"). */
export function formatTokens(tokensIn: number, tokensOut: number): string {
  return `${(tokensIn / 1000).toFixed(0)}k→${(tokensOut / 1000).toFixed(1)}k`;
}

/**
 * USD cost with fixed 4 decimals (e.g. "$0.0013"). Four decimals because the
 * cheap models we default to land around $0.001 per run — toFixed(2) would
 * flatten every one of them to "$0.00". Null (unknown model price, or a run
 * from before cost was persisted) renders as an em dash, never "$NaN".
 *
 * Shared by all three cost surfaces: the PR-list column, the run timeline,
 * and the trace drawer's COST stat.
 */
export function formatCost(usd: number | null | undefined): string {
  return usd == null ? "—" : `$${usd.toFixed(4)}`;
}
