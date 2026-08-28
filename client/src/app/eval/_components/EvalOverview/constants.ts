import type { EvalTrendPoint } from "@devdigest/shared";

/** Locale-neutral placeholder for a metric or cost the API reported as `null`
    (e.g. `citation_accuracy` when a batch produced zero raw findings, or a
    `cost_usd` recorded before cost tracking existed) — never "0%"/"$0",
    which would read as a real, bad result. Mirrors `NO_VALUE` in the agent
    editor's EvalsTab (`agents/[id]/_components/AgentEditor/_components/
    EvalsTab/constants.ts`) — duplicated locally rather than shared across
    route trees, per `frontend-ui-architecture`. */
export const NO_VALUE = "—";

/** Colour per metric, additive to the printed percentage (AC-39, AC-44) —
    the block's colour is never the sole carrier of the value (NFR
    Доступність), the number is always printed alongside it. Matches the
    agent page's own trend legend (`AgentDashboard/AgentDashboard.tsx:214-223`,
    `dashboard.legend.*`), so the same three metrics read the same colour on
    both eval screens. Keyed on the short name (`citation`, not
    `citation_accuracy`) to match the existing `dashboard.table.citation` /
    AC-39 `CITE` label, not the wire field name. */
export const METRIC_COLOR = {
  recall: "var(--accent)",
  precision: "var(--ok)",
  citation: "var(--warn)",
} as const;

export type MetricColorKey = keyof typeof METRIC_COLOR;

/** Below this many points, the agent row's sparkline (AC-40) draws neither a
    line nor a zero axis. Also the point count at which the vendored
    `Sparkline`'s own `i / (data.length - 1)` would divide by zero
    (`vendor/ui/charts/Sparkline.tsx:19`) — this constant is checked BEFORE
    the component ever sees a one-point series. */
export const SPARKLINE_MIN_POINTS = 2;

/** Which field of `EvalTrendPoint` the agent row's sparkline plots (AC-40).
    Pinned to `recall` only by the plan's Contract & migration impact — the
    point's other fields ride along because `EvalAgentSummary.trend` reuses
    the same shape as the agent page's own trend series (AC-41), not because
    this row renders them. */
export const SPARKLINE_METRIC: keyof EvalTrendPoint = "recall";
