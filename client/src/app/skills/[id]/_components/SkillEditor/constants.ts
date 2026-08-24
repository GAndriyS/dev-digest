import type { IconName } from "@devdigest/ui";

/** Editor tab descriptor. `labelKey` resolves under the `skills` namespace. */
export interface EditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/** Tab keys accepted in `?tab=`; anything else falls back to DEFAULT_TAB. */
export const VALID_TABS = ["config", "context", "preview", "evals", "stats", "versions"];

export const DEFAULT_TAB = "config";

export const TABS: readonly EditorTab[] = [
  { key: "config", labelKey: "tabs.config", icon: "Settings" },
  { key: "context", labelKey: "tabs.context", icon: "FileText" },
  { key: "preview", labelKey: "tabs.preview", icon: "Eye" },
  { key: "evals", labelKey: "tabs.evals", icon: "FlaskConical" },
  { key: "stats", labelKey: "tabs.stats", icon: "BarChart" },
  { key: "versions", labelKey: "tabs.versions", icon: "History" },
];
