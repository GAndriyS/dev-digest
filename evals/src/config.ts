/**
 * All tunables in one place. No logic here — just the knobs the rest of the package reads.
 * Nothing in this module imports from another src module (it is the bottom of the dependency
 * graph): config knows nothing of runtime, scoring, or the SDK.
 */

// --- Models -----------------------------------------------------------------
// Cheap model under test by default; the judge is a stronger family to soften self-preference.
export const EVAL_MODEL = process.env.EVAL_MODEL ?? "claude-haiku-4-5";
export const EVAL_JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL ?? "claude-sonnet-5";
export const MAX_TURNS = Number(process.env.EVAL_MAX_TURNS ?? "8");

// --- Configuration tag ------------------------------------------------------
// "candidate" = artifact injected (normal). "baseline" = no artifact (benchmark lift baseline).
export const EVAL_CONFIG = process.env.EVAL_CONFIG ?? "candidate";
export const IS_BASELINE = EVAL_CONFIG === "baseline";

// --- Repetition budget ------------------------------------------------------
// How many times a multi-run tool (repeat, benchmark) may run the same pattern. Both the default
// and the CAP are 2: a session is the expensive unit here, and 2 already catches a blatantly
// flaky case. Raising it is a deliberate act, not a flag typo — export EVAL_MAX_REPEATS.
//
// What you give up at n=2: every pass rate is 0/50/100%, so a single coin-flip moves a practice
// by 50 points and an A/B delta cannot be told from noise (measured 2026-08-25 on the
// architecture-reviewer citation A/B). The stats layer wants 5, and below 5 `repeat` stamps its
// stddev "indicative only". So: n=2 to check stability, EVAL_MAX_REPEATS=5 to MEASURE a change.
export const MAX_REPEATS = Number(process.env.EVAL_MAX_REPEATS ?? "2");

// --- Scoring / statistics thresholds ---------------------------------------
export const DEFAULT_THRESHOLD = 0.6; // judge score gate for a quality case
export const FLAKY_LOW = 0.2; // pass rate strictly inside (20%, 80%) is "flaky"
export const FLAKY_HIGH = 0.8;
export const COST_REGRESSION_RATIO = 1.25; // candidate mean tokens > 125% of baseline

// --- Tool allow-lists -------------------------------------------------------
// Subagent-spawning tool name varies by harness; count both.
export const SPAWN_TOOLS = new Set(["Task", "Agent"]);
// workflowTask runs against the LIVE repo with bypassPermissions — keep this read-only.
export const WORKFLOW_ALLOWED_TOOLS = ["Read", "Grep", "Glob", "Task", "Agent", "Skill"];
/**
 * The read-only list above turned out to be a DECLARATION, not a restriction: under
 * bypassPermissions a workflow session reached for `Write`, `Edit` and `Bash` anyway, and the
 * engineering-insights activation case wrote its synthetic pgvector finding straight into the real
 * server/INSIGHTS.md (measured 2026-08-25, 12-session repeat). `disallowedTools` is the half the
 * SDK actually enforces, so the mutating tools are named here explicitly.
 *
 * Note what this does NOT cover: a dispatched subagent carries its own tool set (spec-creator has
 * Write/Edit), so a dispatch case still relies on `stopWhen` tearing the session down at the
 * launch. Keep dispatch cases early-stopping.
 */
export const WORKFLOW_DISALLOWED_TOOLS = ["Write", "Edit", "NotebookEdit", "Bash"];

// --- Output verbosity -------------------------------------------------------
// Set EVAL_QUIET to suppress per-run trace/verdict spam during multi-run aggregation.
export const QUIET = Boolean(process.env.EVAL_QUIET);
