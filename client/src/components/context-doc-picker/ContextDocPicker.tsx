/* ContextDocPicker — attach project-context documents to an agent or a skill,
   and order them.

   Shared (src/components/) rather than route-local on purpose: both the Agent
   editor's Context tab (AC-10/AC-11) and the Skill editor's "Project context to
   use" section (AC-15) mount it, and `src/app/skills/**` may not import from
   `src/app/agents/**` (dependency-cruiser: no-cross-route-internals).

   Order is the product feature, not decoration — for an agent, attached
   documents are injected into the review prompt in exactly this sequence
   (AC-18), so reordering is a real edit and is persisted as such: the whole set
   is POSTed back via `{paths}`, the same set-write contract `AgentSkillPicker`
   uses for skill links.

   Reorder must feel instant, so the list is optimistic: `draft` takes over the
   moment the user acts, and is dropped again if the write fails (the server
   list is then the truth). Both affordances are supported — HTML5 drag for the
   mouse, ArrowUp/ArrowDown buttons for the keyboard and for touch. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState, Markdown, SectionLabel, Skeleton, TextInput } from "@devdigest/ui";
import {
  useContextDoc,
  useContextFiles,
  useOwnerContext,
  useSetOwnerContext,
  type ContextOwnerType,
} from "../../lib/hooks/core";
import { ContextDocRow } from "./ContextDocRow";
import { matchesFilter, moveItem, partitionFiles, totalTokensEst } from "./helpers";
import { s } from "./styles";

export interface ContextDocPickerProps {
  repoId: string | null | undefined;
  ownerType: ContextOwnerType;
  ownerId: string;
  /** Overrides the default heading — the skill editor's section is titled
   *  "Project context to use" (AC-15); the agent tab uses the neutral default. */
  title?: string;
  hint?: string;
}

export function ContextDocPicker({ repoId, ownerType, ownerId, title, hint }: ContextDocPickerProps) {
  const t = useTranslations("context");
  const filesQuery = useContextFiles(repoId);
  const linksQuery = useOwnerContext(ownerType, ownerId);
  const setPaths = useSetOwnerContext();

  const [query, setQuery] = React.useState("");
  /** Optimistic order; `null` means "the server list is the truth". */
  const [draft, setDraft] = React.useState<string[] | null>(null);
  const [dragFrom, setDragFrom] = React.useState<number | null>(null);
  const [dragOver, setDragOver] = React.useState<number | null>(null);
  const [previewPath, setPreviewPath] = React.useState<string | null>(null);

  // Switching owners inside the editor keeps this component mounted; the
  // draft and open preview belong to the owner they were made for.
  React.useEffect(() => {
    setDraft(null);
    setPreviewPath(null);
  }, [ownerId]);

  const serverPaths = linksQuery.data?.paths ?? [];
  const attachedPaths = draft ?? serverPaths;

  const commit = (next: string[]) => {
    setDraft(next);
    setPaths.mutate(
      { ownerType, ownerId, paths: next },
      // Roll back to the server list rather than to the previous draft: after a
      // failed write the server is the only order we can still vouch for.
      { onError: () => setDraft(null) },
    );
  };

  const toggle = (path: string) =>
    commit(
      attachedPaths.includes(path)
        ? attachedPaths.filter((p) => p !== path)
        : // A newly attached document goes last — appending never silently
          // reshuffles the prompt the user already arranged.
          [...attachedPaths, path],
    );

  const move = (from: number, to: number) => {
    if (to < 0 || to >= attachedPaths.length) return;
    commit(moveItem(attachedPaths, from, to));
  };

  const togglePreview = (path: string) => setPreviewPath((p) => (p === path ? null : path));

  const endDrag = () => {
    setDragFrom(null);
    setDragOver(null);
  };

  const dragPropsFor = (index: number): React.HTMLAttributes<HTMLLIElement> => ({
    onDragStart: (e) => {
      setDragFrom(index);
      e.dataTransfer.effectAllowed = "move";
      // Firefox ignores a drag that carries no payload.
      e.dataTransfer.setData("text/plain", String(index));
    },
    onDragOver: (e) => {
      if (dragFrom === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDragOver(index);
    },
    onDrop: (e) => {
      e.preventDefault();
      if (dragFrom !== null && dragFrom !== index) move(dragFrom, index);
      endDrag();
    },
    onDragEnd: endDrag,
  });

  if (filesQuery.isLoading || linksQuery.isLoading) {
    return (
      <div style={s.loading}>
        <Skeleton height={20} width={200} />
        <Skeleton height={44} />
        <Skeleton height={44} />
        <Skeleton height={44} />
      </div>
    );
  }

  if (filesQuery.isError || linksQuery.isError) {
    return <EmptyState icon="AlertTriangle" title={t("picker.loadError")} />;
  }

  const files = filesQuery.data?.files ?? [];
  if (files.length === 0 && attachedPaths.length === 0) {
    return (
      <EmptyState
        icon="FileText"
        title={t("picker.emptyTitle")}
        body={t("picker.emptyBody", {
          roots: (filesQuery.data?.roots ?? []).join(", "),
          file_names: (filesQuery.data?.file_names ?? []).join(", "),
        })}
      />
    );
  }

  const { attached, available } = partitionFiles(files, attachedPaths);
  const shownAttached = attached.filter((row) => matchesFilter(row.path, query));
  const shownAvailable = available.filter((f) => matchesFilter(f.path, query));
  const noMatches = shownAttached.length === 0 && shownAvailable.length === 0;
  const tokensTotal = totalTokensEst(files, attachedPaths);

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{title ?? t("picker.title")}</h2>
        <span style={s.count}>{t("picker.attachedCount", { attached: attachedPaths.length, total: files.length })}</span>
      </div>
      <p style={s.hint}>{hint ?? t("picker.hint")}</p>
      <TextInput value={query} onChange={setQuery} placeholder={t("picker.filterPlaceholder")} />

      {noMatches && <EmptyState icon="Search" title={t("picker.noMatches", { query })} />}

      {shownAttached.length > 0 && (
        <div style={s.section}>
          <SectionLabel icon="FileText">{t("picker.attachedHeading")}</SectionLabel>
          <ul style={s.list}>
            {shownAttached.map((row) => {
              // Position and moves are relative to the FULL attached order,
              // never to the filtered view — a filter must not renumber the prompt.
              const index = attachedPaths.indexOf(row.path);
              return (
                <ContextDocRow
                  key={row.path}
                  path={row.path}
                  file={row.file}
                  attached
                  position={index + 1}
                  onToggle={() => toggle(row.path)}
                  onMoveUp={() => move(index, index - 1)}
                  onMoveDown={() => move(index, index + 1)}
                  canMoveUp={index > 0}
                  canMoveDown={index < attachedPaths.length - 1}
                  dragging={dragFrom === index}
                  dropTarget={dragOver === index && dragFrom !== null && dragFrom !== index}
                  dragProps={dragPropsFor(index)}
                  previewing={previewPath === row.path}
                  onTogglePreview={row.file ? () => togglePreview(row.path) : undefined}
                  previewBody={previewPath === row.path ? <DocPreview repoId={repoId} path={row.path} /> : null}
                />
              );
            })}
          </ul>
        </div>
      )}

      {shownAvailable.length > 0 && (
        <div style={s.section}>
          <SectionLabel icon="Folder">{t("picker.availableHeading")}</SectionLabel>
          <ul style={s.list}>
            {shownAvailable.map((f) => (
              <ContextDocRow
                key={f.path}
                path={f.path}
                file={f}
                attached={false}
                onToggle={() => toggle(f.path)}
                previewing={previewPath === f.path}
                onTogglePreview={() => togglePreview(f.path)}
                previewBody={previewPath === f.path ? <DocPreview repoId={repoId} path={f.path} /> : null}
              />
            ))}
          </ul>
        </div>
      )}

      <div style={s.footer}>{t("picker.footerTokens", { count: tokensTotal })}</div>
    </div>
  );
}

/** Fetches and renders one document's body on demand — the listing never
 *  carries content (NFR Performance: the walk reads metadata only). */
function DocPreview({ repoId, path }: { repoId: string | null | undefined; path: string }) {
  const t = useTranslations("context");
  const doc = useContextDoc(repoId, path);
  if (doc.isLoading) return <Skeleton height={60} />;
  if (doc.isError) return <span style={s.previewError}>{t("page.previewLoadError")}</span>;
  return <Markdown>{doc.data?.content}</Markdown>;
}
