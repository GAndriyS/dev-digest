import { NO_VALUE } from "./constants";

/** Percentage display for a metric fraction in [0, 1]; `null` renders as an
    em dash, never "0%" — a genuinely null field (e.g. `citation_accuracy`
    when a batch's raw findings were zero), not "no batch has run yet" (the
    caller gates that separately on `recent_batches.length === 0` /
    `last_batch === null`, the CRITICAL seam from plan step 9, AC-29). */
export function pct(value: number | null): string {
  return value == null ? NO_VALUE : `${Math.round(value * 100)}%`;
}

/** Single-locale app (see `src/i18n/request.ts`) — the formatter is a constant. */
const DATE_FORMAT = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

export function formatBatchDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : DATE_FORMAT.format(date);
}

/** USD cost, 4 decimals — cheap default models land around $0.001/run, so
    2 decimals would flatten every one of them to "$0.00". Mirrors
    `formatCost` in `repos/[repoId]/pulls/[number]/_components/
    RunTraceDrawer/helpers.ts`, duplicated locally rather than imported
    across route trees. `null`/`undefined` renders as an em dash. */
export function formatCost(usd: number | null | undefined): string {
  return usd == null ? NO_VALUE : `$${usd.toFixed(4)}`;
}
