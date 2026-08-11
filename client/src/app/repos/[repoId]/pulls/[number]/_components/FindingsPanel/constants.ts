import type { FindingActionKind } from "@devdigest/shared";

/** Sort weight per severity (lower = shown first). */
export const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  WARNING: 1,
  SUGGESTION: 2,
  INFO: 3,
};

/** Confidence below this is hidden when "hide low confidence" is on. */
export const LOW_CONFIDENCE_THRESHOLD = 0.65;

/** Frames the scroll-to-target loop will chase a still-moving layout before
    giving up. ~0.5s at 60fps — long enough for the accordions above to open
    and their cards to expand, short enough that a layout which never settles
    (an animation, a lazily-sized embed) stops rather than spins. */
export const SCROLL_SETTLE_MAX_FRAMES = 30;

/** Keyboard shortcut → finding action. */
export const KEY_TO_ACTION: Record<string, FindingActionKind> = {
  a: "accept",
  d: "dismiss",
};
