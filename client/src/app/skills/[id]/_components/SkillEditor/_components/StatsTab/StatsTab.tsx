/* StatsTab — the skill dashboard: KPI tiles, who links this skill, and where
   the findings landed. Attribution is run-level (see the SkillStats contract),
   and the note under the donut says so rather than implying per-finding proof. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Donut, ErrorState, MetricCard, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillAgents, useSkillStats } from "@/lib/hooks/skills";
import { formatAcceptRate, toDonutSegments } from "./helpers";
import { s } from "./styles";

export function StatsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const { data: stats, isLoading, isError, refetch } = useSkillStats(skill.id);
  const { data: agents } = useSkillAgents(skill.id);

  if (isError) return <ErrorState body={t("stats.loadError")} onRetry={() => refetch()} />;
  if (isLoading || !stats) {
    return (
      <div style={s.skeletons}>
        <Skeleton height={96} />
        <Skeleton height={180} />
      </div>
    );
  }

  const segments = toDonutSegments(stats.findings_by_category);
  const usedBy = agents ?? stats.used_by;

  return (
    <div style={s.wrap}>
      <div style={s.cards}>
        <MetricCard label={t("stats.usedBy")} value={stats.used_by.length} />
        <MetricCard label={t("stats.pullCount")} value={stats.pull_count_30d} />
        <MetricCard
          label={t("stats.acceptRate")}
          value={formatAcceptRate(stats.accept_rate, t("stats.noValue"))}
        />
        <MetricCard label={t("stats.findings")} value={stats.findings_30d} />
      </div>

      <div style={s.section}>
        <h3 style={s.h3}>{t("stats.agentsTitle")}</h3>
        {usedBy.length === 0 ? (
          <div style={s.muted}>{t("stats.agentsEmpty")}</div>
        ) : (
          usedBy.map((u) => (
            <div key={u.agent_id} style={s.agentRow}>
              <span style={s.agentName}>{u.agent_name}</span>
              <Badge color="var(--text-muted)" mono>
                {t("stats.agentOrder", { order: u.order })}
              </Badge>
              {!u.agent_enabled && (
                <Badge color="var(--text-muted)">{t("stats.agentDisabled")}</Badge>
              )}
            </div>
          ))
        )}
      </div>

      <div style={s.section}>
        <h3 style={s.h3}>{t("stats.categoryTitle")}</h3>
        {segments.length === 0 ? (
          <div style={s.muted}>{t("stats.categoryEmpty")}</div>
        ) : (
          <Donut segments={segments} valuePrefix="" />
        )}
        <div style={s.note}>{t("stats.attributionNote")}</div>
      </div>
    </div>
  );
}
