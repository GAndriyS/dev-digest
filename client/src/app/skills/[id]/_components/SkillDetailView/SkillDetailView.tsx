/* /skills/:id — the right column's content once a skill is selected: loads
   the skill, paints its header, and hands the rest to the tabbed SkillEditor.
   AppShell, breadcrumbs and the left column live one level up in
   SkillsLabShell (L05) — this only ever renders inside that shell's detail
   column, never on its own. Kept separate from the editor so the editor only
   ever deals with a resolved Skill (no loading/404 branches inside the tabs). */
"use client";

import React from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { useDeleteSkill, useSkill } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { ApiError } from "@/lib/api";
import { SkillEditor } from "../SkillEditor";
import { s } from "./styles";

export function SkillDetailView() {
  const t = useTranslations("skills");
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { data: skill, isLoading, isError, error, refetch } = useSkill(id);
  const del = useDeleteSkill();

  // A missing skill 404s; anything else is a transport/server failure. Both are
  // terminal for this route, but only one of them is worth a Retry button.
  const notFound = error instanceof ApiError && error.status === 404;

  if (isError) {
    return notFound ? (
      <EmptyState
        icon="Search"
        title={t("detail.notFound.title")}
        body={t("detail.notFound.body")}
        cta={t("detail.back")}
        onCta={() => router.push("/skills")}
      />
    ) : (
      <ErrorState fullScreen body={t("detail.loadError")} onRetry={() => refetch()} />
    );
  }

  if (isLoading || !skill) {
    return (
      <div style={s.loading}>
        <Skeleton height={24} width={240} />
        <Skeleton height={200} />
      </div>
    );
  }

  const untrusted = skill.source === "imported_url" || skill.source === "community";

  const remove = () => {
    if (!window.confirm(t("detail.deleteConfirm", { name: skill.name }))) return;
    del.mutate(skill.id, {
      onSuccess: () => {
        toast.success(t("detail.deleted", { name: skill.name }));
        router.push("/skills");
      },
    });
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <Icon.Sparkles size={18} style={s.icon} />
        <h1 style={s.h1}>{skill.name}</h1>
        <Badge color="var(--text-secondary)" mono>
          {t("preview.version", { version: skill.version })}
        </Badge>
        <Badge color="var(--text-muted)">{t(`listItem.type.${skill.type}`)}</Badge>
        {!skill.enabled && <Badge color="var(--text-muted)">{t("preview.disabled")}</Badge>}
        {untrusted && (
          <Badge color="var(--warn)" icon="AlertTriangle">
            {t("preview.untrustedBadge")}
          </Badge>
        )}
        <div style={s.spacer}>
          <Button kind="danger" size="sm" icon="Trash" onClick={remove} disabled={del.isPending}>
            {t("detail.delete")}
          </Button>
        </div>
      </div>

      {untrusted && <div style={s.notice}>{t("preview.untrustedNotice")}</div>}

      <SkillEditor skill={skill} />
    </div>
  );
}
