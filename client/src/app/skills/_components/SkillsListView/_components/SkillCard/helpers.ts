import type { SkillStats } from "@devdigest/shared";

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
