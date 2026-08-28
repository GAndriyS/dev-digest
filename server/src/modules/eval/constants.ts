/**
 * Module-wide constants for the eval pipeline (SPEC-05). Kept in their own
 * file, no imports, so the dashboard (step 9) and the scorer (this step) can
 * both depend on them without depending on each other.
 */

/**
 * Regression-banner threshold, in percentage points. If `recall` or
 * `precision` of the latest batch drops by at least this many points versus
 * the previous batch, the dashboard surfaces an alert (AC-31). Default from
 * the spec's open question — 2 points.
 */
export const REGRESSION_THRESHOLD_PP = 2;

/** Max rows rendered in the "recent batches" table on the dashboard. */
export const BATCH_TABLE_LIMIT = 20;
