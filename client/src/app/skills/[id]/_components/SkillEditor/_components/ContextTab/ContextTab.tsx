/* ContextTab — the skill's "Project context to use" section (AC-12/AC-15),
   moved here from ConfigTab so it lives on its own tab. A thin mount for the
   shared picker: `src/app/skills/**` may not import `src/app/agents/**`
   internals (dependency-cruiser: no-cross-route-internals), and the picker
   already lives in `src/components/` for exactly that reason — the Agent
   editor's Context tab mounts the same barrel.

   Unlike the agent tab, this one shows an explicit "no repository selected"
   state (AC-14): `useContextFiles(null)` is simply disabled and renders an
   empty document list, which would read as "no documents" rather than "no
   repo" — a real gap the agent tab still has (see the plan's Recommendations;
   left local to this tab by default). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { ContextDocPicker } from "@/components/context-doc-picker";
import { useActiveRepo } from "@/lib/repo-context";

export function ContextTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const tContext = useTranslations("context");
  const { repoId, reposLoaded } = useActiveRepo();

  if (reposLoaded && !repoId) {
    return (
      <EmptyState
        icon="GitBranch"
        title={t("contextTab.noRepo.title")}
        body={t("contextTab.noRepo.body")}
      />
    );
  }

  return (
    <ContextDocPicker
      repoId={repoId}
      ownerType="skill"
      ownerId={skill.id}
      title={tContext("picker.skillTitle")}
      hint={tContext("picker.skillHint")}
    />
  );
}
