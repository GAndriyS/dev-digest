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

/** `smartDiff.*` description key for each role's group header. */
export const ROLE_DESC_KEY: Record<SmartDiffRole, "coreDesc" | "wiringDesc" | "boilerplateDesc"> = {
  core: "coreDesc",
  wiring: "wiringDesc",
  boilerplate: "boilerplateDesc",
};

/** Colour of each role group's header marker square. */
export const ROLE_MARKER_COLOR: Record<SmartDiffRole, string> = {
  core: "var(--accent)",
  wiring: "var(--warn)",
  boilerplate: "var(--text-muted)",
};
