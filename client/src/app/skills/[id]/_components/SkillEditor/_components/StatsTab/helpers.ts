import type { DonutSegment } from "@devdigest/ui";
import type { SkillStats } from "@devdigest/shared";
import { CATEGORY_COLORS, PALETTE } from "./constants";

/** Findings-by-category → Donut segments, with a stable colour per category. */
export function toDonutSegments(rows: SkillStats["findings_by_category"]): DonutSegment[] {
  return rows.map((row, i) => ({
    label: row.category,
    value: row.count,
    color: CATEGORY_COLORS[row.category] ?? PALETTE[i % PALETTE.length] ?? "var(--accent)",
  }));
}

/** accept_rate is 0..1 or null (nothing triaged yet) — never render "0%" for null. */
export function formatAcceptRate(rate: number | null | undefined, noValue: string): string {
  if (rate == null) return noValue;
  return `${Math.round(rate * 100)}%`;
}
