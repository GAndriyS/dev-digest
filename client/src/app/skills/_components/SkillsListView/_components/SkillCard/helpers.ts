import type { Skill, SkillStats, SkillType } from "@devdigest/shared";
import { pullFrequency } from "../../../../helpers";

/** Accent per skill type so the list is scannable without reading the badge. */
const TYPE_COLORS: Record<SkillType, string> = {
  rubric: "var(--accent)",
  convention: "var(--sugg)",
  security: "var(--crit)",
  custom: "var(--text-secondary)",
};

/**
 * Card-level: `SkillPreviewPane` — the other consumer this once had to agree
 * with — was removed by the L05 redesign, and `SkillCard` is the only place
 * left that reads a skill's type colour.
 */
export function typeColor(type: SkillType): string {
  return TYPE_COLORS[type] ?? "var(--text-secondary)";
}

/** True for sources whose text arrived from outside the workspace. */
export function isUntrusted(source: Skill["source"]): boolean {
  return source === "imported_url" || source === "community";
}

/**
 * Values for the `listItem.stats` line: "N agents · X% pull · Y% accept".
 * A type alias, not an interface — next-intl's `TranslationValues` needs an
 * implicit index signature, which interfaces do not get.
 */
export type SkillStatsLine = {
  agents: number;
  /** Share of the last 30 days' runs that pulled this skill in, 0–100. */
  pull: number;
  /** accepted / (accepted + dismissed) as a percentage, or "—" when untriaged. */
  accept: number | string;
};

export function statsLine(stats: SkillStats, noValue: string): SkillStatsLine {
  return {
    agents: stats.used_by.length,
    pull: pullFrequency(stats),
    accept: stats.accept_rate == null ? noValue : Math.round(stats.accept_rate * 100),
  };
}
