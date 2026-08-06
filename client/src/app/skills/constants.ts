import type { SkillType } from "@devdigest/shared";

/**
 * Selectable skill types (labels are i18n'd by the consumer under
 * `skills.listItem.type.*`). Route-level because both the add drawer and the
 * editor's Config tab offer the same set — typed on the contract so adding a
 * member server-side breaks the build here rather than drifting silently.
 */
export const SKILL_TYPE_VALUES: readonly SkillType[] = [
  "rubric",
  "convention",
  "security",
  "custom",
];
