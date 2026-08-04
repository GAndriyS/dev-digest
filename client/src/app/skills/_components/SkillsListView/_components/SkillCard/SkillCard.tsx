/* SkillCard — one row in the /skills master rail: name, type + source badges,
   description, enabled toggle and the usage line. The usage numbers come from
   this skill's own stats query (one per card — the list is workspace-sized, and
   React Query dedupes it with the Stats tab's copy). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, Toggle } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillStats } from "@/lib/hooks/skills";
import { statsLine, typeColor } from "./helpers";
import { s } from "./styles";

export function SkillCard({
  skill,
  active,
  onClick,
  onToggle,
}: {
  skill: Skill;
  active?: boolean;
  onClick?: () => void;
  onToggle?: (enabled: boolean) => void;
}) {
  const t = useTranslations("skills");
  const { data: stats } = useSkillStats(skill.id);
  const color = typeColor(skill.type);
  // 'manual' and 'extracted' are ours; a URL/community import is unvetted.
  const untrusted = skill.source === "imported_url" || skill.source === "community";

  return (
    <div onClick={onClick} style={s.card(!!active, skill.enabled)}>
      <div style={s.headerRow}>
        <div style={s.iconBox(color)}>
          <Icon.Sparkles size={15} />
        </div>
        <span style={s.name}>{skill.name}</span>
        {onToggle && (
          <div onClick={(e) => e.stopPropagation()} title={t("listItem.toggleLabel")}>
            <Toggle on={skill.enabled} onChange={onToggle} size={14} />
          </div>
        )}
      </div>

      <div style={s.description}>{skill.description || t("listItem.noDescription")}</div>

      <div style={s.badgeRow}>
        <Badge color={color}>{t(`listItem.type.${skill.type}`)}</Badge>
        <Badge color="var(--text-muted)">{t(`listItem.source.${skill.source}`)}</Badge>
        {untrusted && (
          <span title={t("listItem.vettingTitle")}>
            <Badge color="var(--warn)" icon="AlertTriangle">
              {t("listItem.needsVetting")}
            </Badge>
          </span>
        )}
      </div>

      {stats && (
        <div className="tnum" style={s.stats}>
          {t("listItem.stats", statsLine(stats, t("stats.noValue")))}
        </div>
      )}
    </div>
  );
}
