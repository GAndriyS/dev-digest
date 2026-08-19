/* SkillsLabShell — the master-detail chrome for the Skills Lab (L05): AppShell
   + breadcrumbs, a header with search and the Add Skill menu, a left column
   with the full skill list (every state) and a right column that is whatever
   the current route renders (`{children}` — the select prompt at /skills, the
   full editor at /skills/:id). Selecting a card is ONE navigation, never local
   state, so the URL is always the source of truth for "which skill" and "which
   tab"; that is also what lets this layout persist across the two routes
   instead of remounting the list on every selection. */
"use client";

import React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Dropdown, Icon } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useSkills } from "@/lib/hooks/skills";
import { useMediaQuery } from "@/lib/use-media-query";
import { DEFAULT_TAB } from "../../[id]/_components/SkillEditor";
import { SkillDirtyGateProvider } from "../SkillDirtyGate";
import { SkillsListView } from "../SkillsListView";
import { AddSkillDrawer } from "./_components/AddSkillDrawer";
import { DiscardChangesDialog } from "./_components/DiscardChangesDialog";
import { ImportSkillDrawer } from "./_components/ImportSkillDrawer";
import type { AddFlow } from "./constants";
import { NARROW_QUERY } from "./constants";
import { skillHref, skillIdFromPathname } from "./helpers";
import { s } from "./styles";

export function SkillsLabShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const isNarrow = useMediaQuery(NARROW_QUERY);

  const [query, setQuery] = React.useState("");
  const [adding, setAdding] = React.useState<AddFlow | null>(null);

  // AC-7: ConfigTab (several route segments below, through SkillDirtyGate)
  // registers whether it has unsaved edits. The shell owns the value — a
  // plain useState, not read back out of context — so gating a navigation
  // needs no round trip; only the setter travels down.
  const [dirty, setDirty] = React.useState(false);
  const [pendingSwitch, setPendingSwitch] = React.useState<(() => void) | null>(null);

  const all = skills ?? [];
  const id = skillIdFromPathname(pathname);
  // Name for the breadcrumb comes from the already-loaded list, not a second
  // fetch — the detail route fetches the skill again on its own for the parts
  // that actually need the full record.
  const selected = id ? (all.find((sk) => sk.id === id) ?? null) : null;

  // AC-5 vs AC-6: a `:id` that never appeared in a loaded list is "not found"
  // (the detail route's own 404 renders that); one that WAS listed and then
  // drops out — deleted here or from another tab — sends the screen back to
  // /skills instead of leaving a stale editor on screen.
  const seenRef = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    if (!skills) return;
    for (const sk of skills) seenRef.current.add(sk.id);
  }, [skills]);

  React.useEffect(() => {
    if (!id || isLoading || isError || !skills) return;
    const stillListed = skills.some((sk) => sk.id === id);
    if (!stillListed && seenRef.current.has(id)) {
      router.push("/skills");
    }
  }, [id, skills, isLoading, isError, router]);

  const currentTab = search?.get("tab") ?? DEFAULT_TAB;

  // AC-7: picking a different skill while the editor is dirty asks first —
  // "chooses ANOTHER skill" is the trigger, so re-clicking the already
  // selected card is a no-op, not a switch, and never opens the dialog.
  // Cancel just drops the pending navigation; nothing has moved, so there is
  // nothing to restore. Discard runs the switch that was on hold.
  const selectSkill = (skillId: string) => {
    if (skillId === id) return;
    const go = () => router.push(skillHref(skillId, currentTab));
    if (dirty) setPendingSwitch(() => go);
    else go();
  };

  const crumb = [
    { label: t("page.crumbLab") },
    { label: t("page.crumbSkills"), href: "/skills" },
    ...(id ? [{ label: selected?.name ?? t("detail.crumbSkill") }] : []),
  ];

  const showList = !isNarrow || !id;
  const showDetail = !isNarrow || !!id;

  return (
    <AppShell crumb={crumb}>
      {adding === "create" && <AddSkillDrawer onClose={() => setAdding(null)} />}
      {adding === "import" && <ImportSkillDrawer onClose={() => setAdding(null)} />}
      <div style={s.wrap}>
        <div style={s.header}>
          <h1 style={s.h1}>{t("page.heading")}</h1>
          <div style={s.search}>
            <Icon.Search size={13} style={s.searchIcon} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("page.searchPlaceholder")}
              aria-label={t("page.searchPlaceholder")}
              style={s.searchInput}
            />
          </div>
          <Dropdown
            width={220}
            align="right"
            trigger={
              <Button kind="primary" size="sm" icon="Plus" iconRight="ChevronDown" style={s.addButton}>
                {t("page.addSkill")}
              </Button>
            }
            items={[
              { label: t("page.menu.create"), icon: "Edit", onClick: () => setAdding("create") },
              { label: t("page.menu.fromFile"), icon: "Upload", onClick: () => setAdding("import") },
            ]}
          />
        </div>

        <div style={s.body}>
          {showList && (
            <div style={s.listCol(isNarrow)}>
              <SkillsListView
                skills={all}
                isLoading={isLoading}
                isError={isError}
                onRetry={() => refetch()}
                search={query}
                selectedId={id}
                onSelect={selectSkill}
                onImportCta={() => setAdding("import")}
              />
            </div>
          )}

          {showDetail && (
            <div style={s.detailCol}>
              {isNarrow && id && (
                <button type="button" onClick={() => router.push("/skills")} style={s.backToList}>
                  {t("page.backToList")}
                </button>
              )}
              <SkillDirtyGateProvider onDirtyChange={setDirty}>{children}</SkillDirtyGateProvider>
            </div>
          )}
        </div>
      </div>

      {pendingSwitch && (
        <DiscardChangesDialog
          onDiscard={() => {
            const go = pendingSwitch;
            setPendingSwitch(null);
            setDirty(false);
            go();
          }}
          onCancel={() => setPendingSwitch(null)}
        />
      )}
    </AppShell>
  );
}
