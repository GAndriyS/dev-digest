import type { IconName } from "@devdigest/ui";

/** Height of the loading placeholder while the intent record is being fetched. */
export const CARD_SKELETON_HEIGHT = 160;

/** A risk area arrives as free text from the model, so its icon and colour are
    derived from what it says rather than stored. First match wins; anything
    unmatched falls back to RISK_FALLBACK, so an unrecognised risk still renders
    as a risk. Presentation only — nothing downstream reads this. */
export const RISK_TONES: readonly { pattern: RegExp; icon: IconName; tone: "crit" | "warn" }[] = [
  { pattern: /auth|permission|token|session|credential|secret|access control/i, icon: "Shield", tone: "crit" },
  { pattern: /migration|schema change|data loss|database/i, icon: "Database", tone: "crit" },
  { pattern: /dependenc|package|library|upgrade|version bump/i, icon: "Boxes", tone: "warn" },
  { pattern: /perf|latency|round.?trip|throughput|memory|n\+1|slow/i, icon: "Zap", tone: "warn" },
];

export const RISK_FALLBACK = { icon: "AlertTriangle", tone: "warn" } as const;
