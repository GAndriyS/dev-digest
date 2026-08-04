/* /skills — Skills Lab list (L02). A responsive grid of skill cards (name, type,
   description, enabled toggle); selecting one opens a preview BESIDE the grid
   with the body rendered as the reviewing agent receives it and a link into the
   full editor at /skills/:id. Selection is local state, not a route change, so
   the grid keeps its scroll and the toggles stay live while previewing.
   Adding is a two-way menu: author a skill here, or import a Markdown file /
   archive through the preview-then-confirm drawer. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Dropdown, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useSkills, useUpdateSkill } from "@/lib/hooks/skills";
import { SkillCard } from "./_components/SkillCard";
import { SkillPreviewPane } from "./_components/SkillPreviewPane";
import { AddSkillDrawer } from "./_components/AddSkillDrawer";
import { ImportSkillDrawer } from "./_components/ImportSkillDrawer";
import { filterSkills } from "./helpers";
import { s } from "./styles";

/** Which "add" flow is open, if any. */
type AddFlow = "create" | "import";

export function SkillsListView() {
  const t = useTranslations("skills");
  const router = useRouter();
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const update = useUpdateSkill();
  const [search, setSearch] = React.useState("");
  const [adding, setAdding] = React.useState<AddFlow | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const all = skills ?? [];
  const list = filterSkills(all, search);
  const ready = !isLoading && !isError;
  // Derived, not stored: a deleted or refetched-away skill drops out of the
  // pane on its own instead of leaving a stale copy on screen.
  const selected = all.find((sk) => sk.id === selectedId) ?? null;

  return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbSkills") }]}>
      {adding === "create" && <AddSkillDrawer onClose={() => setAdding(null)} />}
      {adding === "import" && <ImportSkillDrawer onClose={() => setAdding(null)} />}
      <div style={s.page}>
        <div style={s.header}>
          <h1 style={s.h1}>{t("page.heading")}</h1>
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
          <Dropdown
            width={220}
            align="right"
            trigger={
              <Button kind="primary" size="sm" icon="Plus" iconRight="ChevronDown">
                {t("page.addSkill")}
              </Button>
            }
            items={[
              { label: t("page.menu.create"), icon: "Edit", onClick: () => setAdding("create") },
              { label: t("page.menu.fromFile"), icon: "Upload", onClick: () => setAdding("import") },
            ]}
          />
        </div>

        <div style={s.split}>
          <div style={s.main}>
            {isLoading && (
              <div style={s.grid}>
                <Skeleton height={132} />
                <Skeleton height={132} />
                <Skeleton height={132} />
              </div>
            )}
            {isError && <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />}
            {ready && all.length === 0 && (
              <EmptyState
                icon="Sparkles"
                title={t("page.empty.title")}
                body={t("page.empty.body")}
                cta={t("page.empty.cta")}
                onCta={() => setAdding("import")}
              />
            )}
            {ready && all.length > 0 && list.length === 0 && (
              <EmptyState icon="Search" title={t("page.noMatch.title")} body={t("page.noMatch.body")} />
            )}
            {list.length > 0 && (
              <div style={s.grid}>
                {list.map((sk) => (
                  <SkillCard
                    key={sk.id}
                    skill={sk}
                    active={sk.id === selectedId}
                    onClick={() => setSelectedId(sk.id)}
                    onToggle={(enabled) => update.mutate({ id: sk.id, patch: { enabled } })}
                  />
                ))}
              </div>
            )}
          </div>

          <aside style={s.pane}>
            {selected ? (
              <SkillPreviewPane
                skill={selected}
                onOpenEditor={() => router.push(`/skills/${selected.id}?tab=config`)}
              />
            ) : (
              <EmptyState
                icon="Sparkles"
                title={t("page.selectPrompt.title")}
                body={t("page.selectPrompt.body")}
              />
            )}
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
