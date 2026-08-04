import type { SkillStats, SkillType } from "@devdigest/shared";

/** Accent per skill type so the rail is scannable without reading the badge. */
const TYPE_COLORS: Record<SkillType, string> = {
  rubric: "var(--accent)",
  convention: "var(--sugg)",
  security: "var(--crit)",
  custom: "var(--text-secondary)",
};

export function typeColor(type: SkillType): string {
  return TYPE_COLORS[type] ?? "var(--text-secondary)";
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
    // runs_total is the denominator: a skill "pulled" into 3 of 4 runs is 75%.
    pull: stats.runs_total > 0 ? Math.round((stats.pull_count_30d / stats.runs_total) * 100) : 0,
    accept: stats.accept_rate == null ? noValue : Math.round(stats.accept_rate * 100),
  };
}
