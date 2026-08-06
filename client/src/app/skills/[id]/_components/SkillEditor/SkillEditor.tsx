/* SkillEditor — the five-tab shell for one skill. Tab state lives in `?tab=`
   so a deep link (or a browser back) lands on the same tab; `router.replace`
   keeps tab switching out of the history stack. */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Tabs } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { ConfigTab } from "./_components/ConfigTab";
import { PreviewTab } from "./_components/PreviewTab";
import { EvalsTab } from "./_components/EvalsTab";
import { StatsTab } from "./_components/StatsTab";
import { VersionsTab } from "./_components/VersionsTab";
import { DEFAULT_TAB, TABS, VALID_TABS } from "./constants";
import { s } from "./styles";

export function SkillEditor({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const search = useSearchParams();

  const requested = search?.get("tab") ?? "";
  const tab = VALID_TABS.includes(requested) ? requested : DEFAULT_TAB;

  const setTab = (next: string) => {
    const sp = new URLSearchParams(search?.toString() ?? "");
    sp.set("tab", next);
    router.replace(`/skills/${skill.id}?${sp.toString()}`);
  };

  const tabs = TABS.map((tb) => ({ key: tb.key, label: t(tb.labelKey), icon: tb.icon }));

  return (
    <div style={s.wrap}>
      <div style={s.tabsBar}>
        <Tabs tabs={tabs} value={tab} onChange={setTab} pad="0 28px" />
      </div>
      <div style={s.body}>
        {tab === "config" && <ConfigTab skill={skill} />}
        {tab === "preview" && <PreviewTab skill={skill} />}
        {tab === "evals" && <EvalsTab skill={skill} />}
        {tab === "stats" && <StatsTab skill={skill} />}
        {tab === "versions" && <VersionsTab skill={skill} />}
      </div>
    </div>
  );
}
