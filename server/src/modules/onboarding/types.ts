/**
 * Onboarding tour generator — internal types. Published surface alongside
 * `constants.ts` (other modules may import `types.ts`, never
 * `service`/`repository`/`helpers`/`facts`).
 */
import type { OnboardingSkeletonReason } from '@devdigest/shared';

/** One file read off the clone, verbatim (config/manifest excerpt). */
export interface SampleFile {
  path: string;
  content: string;
}

export type FirstTaskSignalKind = 'todo' | 'missing_test';

/**
 * A deterministic, code-found candidate for `first_tasks` (AC-19). `excerpt`
 * is the matched TODO/FIXME line for `kind: 'todo'`, empty for
 * `kind: 'missing_test'` — the model is asked to write a description from
 * this, never to invent the path.
 */
export interface FirstTaskSignal {
  path: string;
  kind: FirstTaskSignalKind;
  excerpt: string;
}

/**
 * Everything code gathers about a repo BEFORE the one model call — facts.ts's
 * output. Every path referenced here is what post-validation (D7) treats as
 * "real" for the generated tour's links.
 */
export interface OnboardingFacts {
  /** Top-ranked file paths, rank DESC (drives `reading_path` order — AC-17). */
  topFiles: string[];
  /** Import-chains from `getCriticalPaths`, highest-ranked roots first. */
  criticalPaths: string[][];
  /** `RUN_CONFIG_FILES` + `<seg>/package.json` reads that succeeded. */
  runFiles: SampleFile[];
  /** TODO/FIXME markers + missing-sibling-test signals (AC-19). */
  taskSignals: FirstTaskSignal[];
}

/** What one `generate()` call reports for the server log line (D8, A8). */
export interface OnboardingTelemetry {
  provider: string;
  model: string;
  /** Provider round-trips — 1 for an attempted generation, 0 for a structural skeleton. */
  calls: number;
  /** `completeStructured`'s attempt count (retries collapse into ONE call — AC-34). */
  attempts: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  /** Links/paths the model proposed that were not in the collected facts (D7). */
  droppedPaths: number;
  repoId: string;
  durationMs: number;
  /** Present only when the result is a skeleton (AC-35). */
  reason?: OnboardingSkeletonReason;
}
