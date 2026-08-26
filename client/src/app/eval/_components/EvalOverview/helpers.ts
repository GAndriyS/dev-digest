import { NO_VALUE } from "./constants";

/** Percentage display for a metric fraction in [0, 1]; `null` renders as an
    em dash, never "0%" — a genuinely null field (e.g. `citation_accuracy`
    when a batch's raw findings were zero), not "no batch has run yet" (the
    caller gates that separately on `recent_batches.length === 0` /
    `last_batch === null`, the CRITICAL seam from plan step 9, AC-29). */
export function pct(value: number | null): string {
  return value == null ? NO_VALUE : `${Math.round(value * 100)}%`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** `YYYY-MM-DD HH:mm`, LOCAL time (AC-27, AC-38) — the spec's format string
    does not name a zone, the previous `dateStyle: "medium"` formatting was
    local too, and this is a local-first studio (plan step 3, Decisions
    taken). CI runs UTC and a developer's machine does not, so a test on this
    helper must assert the SHAPE (`/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/`) plus a
    value derived by calling this same helper — never a hardcoded date
    literal, which is green in one environment and red in the other. */
export function formatBatchDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const y = date.getFullYear();
  const mo = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  const h = pad2(date.getHours());
  const mi = pad2(date.getMinutes());
  return `${y}-${mo}-${d} ${h}:${mi}`;
}

/** USD cost, 4 decimals — cheap default models land around $0.001/run, so
    2 decimals would flatten every one of them to "$0.00". Mirrors
    `formatCost` in `repos/[repoId]/pulls/[number]/_components/
    RunTraceDrawer/helpers.ts`, duplicated locally rather than imported
    across route trees. `null`/`undefined` renders as an em dash. */
export function formatCost(usd: number | null | undefined): string {
  return usd == null ? NO_VALUE : `$${usd.toFixed(4)}`;
}
