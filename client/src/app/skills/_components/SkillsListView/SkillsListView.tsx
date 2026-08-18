/* SkillsListView — the /skills left column (L02 grid → L05 vertical list): every
   skill in the workspace, keyboard-navigable, with its loading / error / empty /
   no-match states. Selecting a card is a route change owned by the caller
   (SkillsLabShell passes `onSelect`); this component only knows how to render
   the skills it is handed and to flip the `enabled` toggle. Search, the Add
   Skill menu and the two-column chrome live one level up, in SkillsLabShell —
   this stays the list, not the page. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useUpdateSkill } from "@/lib/hooks/skills";
import { SkillCard } from "./_components/SkillCard";
import { filterSkills } from "./helpers";
import { s } from "./styles";

export function SkillsListView({
  skills,
  isLoading,
  isError,
  onRetry,
  search,
  selectedId,
  onSelect,
  onImportCta,
}: {
  skills: Skill[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  search: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onImportCta: () => void;
}) {
  const t = useTranslations("skills");
  const update = useUpdateSkill();

  const list = filterSkills(skills, search);
  const ready = !isLoading && !isError;

  return (
    <div style={s.wrap}>
      {isLoading && (
        <div style={s.list}>
          <Skeleton height={92} />
          <Skeleton height={92} />
          <Skeleton height={92} />
        </div>
      )}

      {isError && <ErrorState body={t("page.loadError")} onRetry={onRetry} />}

      {ready && skills.length === 0 && (
        <EmptyState
          icon="Sparkles"
          title={t("page.empty.title")}
          body={t("page.empty.body")}
          cta={t("page.empty.cta")}
          onCta={onImportCta}
        />
      )}

      {ready && skills.length > 0 && list.length === 0 && (
        <EmptyState icon="Search" title={t("page.noMatch.title")} body={t("page.noMatch.body")} />
      )}

      {list.length > 0 && (
        <div role="list" aria-label={t("page.listLabel")} style={s.list}>
          {list.map((sk) => (
            <SkillCard
              key={sk.id}
              skill={sk}
              active={sk.id === selectedId}
              onClick={() => onSelect(sk.id)}
              onToggle={(enabled) => update.mutate({ id: sk.id, patch: { enabled } })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
