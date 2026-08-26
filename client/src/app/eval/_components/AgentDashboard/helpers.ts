import type { EvalBatchRecord } from "@devdigest/shared";
import { NO_VALUE } from "./constants";

/** Percentage display for a metric fraction in [0, 1]; `null` renders as an
    em dash, never "0%". */
export function pct(value: number | null): string {
  return value == null ? NO_VALUE : `${Math.round(value * 100)}%`;
}

/** Single-locale app (see `src/i18n/request.ts`) — the formatter is a constant. */
const DATE_FORMAT = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

export function formatBatchDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : DATE_FORMAT.format(date);
}

/** USD cost, 4 decimals — see EvalOverview/helpers.ts for why. `null` renders
    as an em dash. */
export function formatCost(usd: number | null | undefined): string {
  return usd == null ? NO_VALUE : `$${usd.toFixed(4)}`;
}

/**
 * A metric delta (fraction, e.g. `0.032`) formatted as a SIGNED percentage
 * point for `dashboard.delta` ("{value} pt" — the caller supplies the sign
 * and the one decimal, per the key's own contract note). `0` — including
 * `-0` from float rounding — renders with no sign, "0.0", never "-0.0"
 * (AC-33's "include the zero delta" case).
 */
export function formatDeltaPt(fraction: number): string {
  const pt = Math.round(fraction * 1000) / 10;
  if (pt === 0) return "0.0";
  const sign = pt > 0 ? "+" : "-";
  return `${sign}${Math.abs(pt).toFixed(1)}`;
}

export type DeltaDirection = "up" | "down" | "flat";

/** Direction for the arrow icon — accessibility requires the sign shown as
    TEXT (`formatDeltaPt`) too, never color/arrow alone (NFR Доступність). */
export function deltaDirection(fraction: number): DeltaDirection {
  if (fraction > 0) return "up";
  if (fraction < 0) return "down";
  return "flat";
}

/**
 * Percentage-point delta between a batch's metric and the SAME metric on the
 * previous batch — used for the regression banner's "direction of the rest
 * of the metrics" (AC-31). `EvalAlert.others` carries the LATEST batch's raw
 * metric values (`server/src/modules/eval/dashboard.ts` `computeAlert`), not
 * a delta, so the previous batch's value has to come from here: the caller
 * passes `recent_batches[1]` (the batch immediately before the one the
 * alert fired on). `null` when there is no previous value to compare
 * against, or either side of a nullable metric (`citation_accuracy`) is
 * null — rendered as "unchanged" rather than a fabricated number.
 */
export function otherMetricDeltaPp(
  latestValue: number,
  previous: EvalBatchRecord | undefined,
  key: "recall" | "precision" | "citation_accuracy"
): number | null {
  if (!previous) return null;
  const previousValue = previous[key];
  if (previousValue == null) return null;
  return Math.round((latestValue - previousValue) * 1000) / 10;
}
