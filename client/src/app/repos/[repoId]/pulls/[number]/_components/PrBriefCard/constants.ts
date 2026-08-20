import type { IconName } from "@devdigest/ui";
import type { RiskSeverity } from "@devdigest/shared";

/** Height of the loading placeholder while the brief is being fetched. */
export const CARD_SKELETON_HEIGHT = 220;

/** `risk_level` (and each individual risk's `severity` — the same enum) reads
    by icon + colour token + text label — never colour alone (AC-31, NFR-6).
    `token` names a `--<token>`/`--<token>-bg` CSS var pair already defined by
    the UI kit (crit/warn/ok), so this stays theme-aware for free. */
export const RISK_LEVEL_TONE: Record<RiskSeverity, { icon: IconName; token: "crit" | "warn" | "ok" }> = {
  high: { icon: "AlertOctagon", token: "crit" },
  medium: { icon: "AlertTriangle", token: "warn" },
  low: { icon: "Check", token: "ok" },
};
