/** Pure helpers for AgentSkillPicker — no React, no data access. */

import type { AgentSkillLink, Skill } from "@devdigest/shared";

/**
 * Skill ids in prompt order. `GET /agents/:id/skills` already returns them
 * ordered, but the order column is the actual contract — sorting on it here
 * means a future endpoint change cannot silently reshuffle the prompt.
 */
export function orderedSkillIds(links: AgentSkillLink[] | undefined): string[] {
  return [...(links ?? [])].sort((a, b) => a.order - b.order).map((l) => l.skill_id);
}

/** Move the item at `from` to `to`, returning a new array. Out-of-range is a no-op. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to) return [...items];
  if (from < 0 || to < 0 || from >= items.length || to >= items.length) return [...items];
  const next = [...items];
  // Spread the removed slice back in rather than indexing it — under
  // noUncheckedIndexedAccess `next.splice(...)[0]` is `T | undefined`.
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

/** Case-insensitive match over name + description. An empty query matches everything. */
export function matchesFilter(skill: Skill, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return skill.name.toLowerCase().includes(q) || skill.description.toLowerCase().includes(q);
}

/**
 * Split the catalog into the skills linked to this agent (in prompt order) and
 * the rest (in catalog order). A linked id with no matching skill is dropped —
 * it would otherwise render as a hole the user cannot act on.
 */
export function partitionSkills(
  skills: readonly Skill[],
  linkedIds: readonly string[],
): { linked: Skill[]; available: Skill[] } {
  const byId = new Map(skills.map((s) => [s.id, s]));
  const linkedSet = new Set(linkedIds);
  return {
    linked: linkedIds.map((id) => byId.get(id)).filter((s): s is Skill => s !== undefined),
    available: skills.filter((s) => !linkedSet.has(s.id)),
  };
}
