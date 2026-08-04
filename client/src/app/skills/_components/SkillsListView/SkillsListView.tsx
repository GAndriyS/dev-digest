/* /skills — Skills Lab master/detail (L02). The rail lists every skill with its
   usage numbers; picking one opens the 5-tab editor at /skills/:id. The right
   pane stays a "select a skill" prompt because selection is a route change. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useSkills, useUpdateSkill } from "@/lib/hooks/skills";
import { SkillCard } from "./_components/SkillCard";
import { AddSkillDrawer } from "./_components/AddSkillDrawer";
import { filterSkills } from "./helpers";
import { s } from "./styles";

export function SkillsListView() {
  const t = useTranslations("skills");
  const router = useRouter();
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const update = useUpdateSkill();
  const [search, setSearch] = React.useState("");
  const [adding, setAdding] = React.useState(false);

  const all = skills ?? [];
  const list = filterSkills(all, search);
  const ready = !isLoading && !isError;

  return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbSkills") }]}>
      {adding && <AddSkillDrawer onClose={() => setAdding(false)} />}
      <div style={s.split}>
        <div style={s.rail}>
          <div style={s.railHeader}>
            <div style={s.railTitleRow}>
              <h1 style={s.h1}>{t("page.heading")}</h1>
              <Button kind="primary" size="sm" icon="Plus" onClick={() => setAdding(true)}>
                {t("page.addSkill")}
              </Button>
            </div>
            <div style={s.search}>
              <Icon.Search size={13} style={s.searchIcon} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("page.searchPlaceholder")}
                aria-label={t("page.searchPlaceholder")}
                style={s.searchInput}
              />
            </div>
          </div>

          <div style={s.railBody}>
            {isLoading && (
              <div style={s.skeletons}>
                <Skeleton height={104} />
                <Skeleton height={104} />
                <Skeleton height={104} />
              </div>
            )}
            {isError && <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />}
            {ready && all.length === 0 && (
              <EmptyState
                icon="Sparkles"
                title={t("page.empty.title")}
                body={t("page.empty.body")}
                cta={t("page.empty.cta")}
                onCta={() => setAdding(true)}
              />
            )}
            {ready && all.length > 0 && list.length === 0 && (
              <EmptyState icon="Search" title={t("page.noMatch.title")} body={t("page.noMatch.body")} />
            )}
            {list.map((sk) => (
              <SkillCard
                key={sk.id}
                skill={sk}
                onClick={() => router.push(`/skills/${sk.id}?tab=config`)}
                onToggle={(enabled) => update.mutate({ id: sk.id, patch: { enabled } })}
              />
            ))}
          </div>
        </div>

        <div style={s.pane}>
          <EmptyState
            icon="Sparkles"
            title={t("page.selectPrompt.title")}
            body={t("page.selectPrompt.body")}
          />
        </div>
      </div>
    </AppShell>
  );
}
