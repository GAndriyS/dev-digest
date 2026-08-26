/** Locale-neutral placeholder for a metric or cost the API reported as
    `null` — never "0%"/"$0", which would read as a real, bad result.
    Duplicated per component (see EvalOverview/constants.ts) rather than
    imported across route trees, per `frontend-ui-architecture`. */
export const NO_VALUE = "—";

/** Metric keys read off `EvalDashboard.current`/`.delta` and off
    `EvalAlert.others`, in the fixed order the three metric cards render. */
export const METRIC_KEYS = ["recall", "precision", "citation_accuracy"] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];
