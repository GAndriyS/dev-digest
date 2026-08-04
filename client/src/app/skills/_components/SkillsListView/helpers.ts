import type { Skill, SkillType } from "@devdigest/shared";

/** Case-insensitive filter over a skill's name + description + type. */
export function filterSkills(skills: Skill[], search: string): Skill[] {
  const q = search.trim().toLowerCase();
  if (!q) return skills;
  return skills.filter((sk) => `${sk.name} ${sk.description} ${sk.type}`.toLowerCase().includes(q));
}

/** Accent per skill type so the grid is scannable without reading the badge. */
const TYPE_COLORS: Record<SkillType, string> = {
  rubric: "var(--accent)",
  convention: "var(--sugg)",
  security: "var(--crit)",
  custom: "var(--text-secondary)",
};

/**
 * Route-level rather than card-level: the card and the preview pane must agree
 * on a type's colour, and two consumers in one feature is the rung where a
 * helper moves up.
 */
export function typeColor(type: SkillType): string {
  return TYPE_COLORS[type] ?? "var(--text-secondary)";
}

/** True for sources whose text arrived from outside the workspace. */
export function isUntrusted(source: Skill["source"]): boolean {
  return source === "imported_url" || source === "community";
}
