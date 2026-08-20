import type { SkillStats } from "@devdigest/shared";

/**
 * Share of the last 30 days' runs that pulled this skill in, 0–100 — e.g. a
 * skill pulled into 3 of 4 runs is 75%. `runs_total = 0` reads as 0%, not a
 * division by zero.
 *
 * Route-level because it now has two consumers reading the exact same number
 * (AC-22 requires it): the list card's usage line (`SkillCard/helpers.ts`,
 * which delegates here) and the editor's Stats tab "PULL FREQUENCY" tile. Two
 * consumers is the step where a helper like this climbs — `typeColor` in
 * `SkillCard/helpers.ts` used to be the example (it once had a second
 * consumer, `SkillPreviewPane`), but the L05 redesign deleted that consumer,
 * so it moved back down; this one still genuinely has two.
 */
export function pullFrequency(stats: Pick<SkillStats, "pull_count_30d" | "runs_total">): number {
  return stats.runs_total > 0 ? Math.round((stats.pull_count_30d / stats.runs_total) * 100) : 0;
}
