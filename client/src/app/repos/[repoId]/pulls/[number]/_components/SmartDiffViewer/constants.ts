import type { SmartDiffRole } from "@devdigest/shared";

/** Whether each role group starts open on mount. `null` leaves FileCard's own
    size heuristic in charge (per-file, based on changed-line count) — only
    `boilerplate` (lock files, generated assets) is forced closed regardless of
    size, per the L03 decision that a lock file is always boilerplate and
    always starts collapsed. */
export const DEFAULT_OPEN_BY_ROLE: Record<SmartDiffRole, boolean | null> = {
  core: null,
  wiring: null,
  boilerplate: false,
};

/** `smartDiff.*` label key (in `messages/en/prReview.json`) for each role. */
export const ROLE_LABEL_KEY: Record<SmartDiffRole, "coreLabel" | "wiringLabel" | "boilerplateLabel"> = {
  core: "coreLabel",
  wiring: "wiringLabel",
  boilerplate: "boilerplateLabel",
};
