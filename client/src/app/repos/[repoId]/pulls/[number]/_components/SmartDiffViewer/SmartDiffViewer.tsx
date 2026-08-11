/* SmartDiffViewer — L03: orders a PR's Diff tab by risk (core → wiring →
   boilerplate), deterministically, from GET /pulls/:id/smart-diff. No new
   model call: the endpoint combines already-imported pr_files with the
   findings of every kind:'review' run, dismissed excluded.

   Ranking is a courtesy, not a requirement — on any fetch error, an empty
   response, or before a review exists, this falls back to the plain
   DiffViewer so the tab never loses the diff because ranking failed. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SectionLabel, Skeleton } from "@devdigest/ui";
import type { PrFile, SmartDiffGroup } from "@devdigest/shared";
import { DiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import { usePrSmartDiff } from "@/lib/hooks/reviews";
import { buildFileMeta, groupFindingLineCount, groupFiles, ungroupedFiles, type FileMetaEntry } from "./helpers";
import { DEFAULT_OPEN_BY_ROLE, ROLE_LABEL_KEY } from "./constants";
import { s, chevronFor } from "./styles";

/** One collapsible role group — header (role label, file count, finding-line
    count) plus its files rendered through the shared DiffViewer, which is
    also what applies each file's `defaultOpen`/`findingLines` override. */
function RoleGroup({
  group,
  files,
  fileMeta,
  commenting,
  t,
}: {
  group: SmartDiffGroup;
  files: PrFile[];
  fileMeta: Record<string, FileMetaEntry>;
  commenting?: DiffCommentApi;
  t: ReturnType<typeof useTranslations>;
}) {
  // `null` in DEFAULT_OPEN_BY_ROLE means "no group-level opinion" — the group
  // opens and each FileCard's own size heuristic decides. Only `boilerplate`
  // names a value, and it closes the group itself, not just the files inside:
  // a lock file whose path is still on screen has not been got out of the way.
  const [open, setOpen] = React.useState(DEFAULT_OPEN_BY_ROLE[group.role] ?? true);
  const findingLines = groupFindingLineCount(group);

  return (
    <div style={s.group}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
        style={s.groupHeader}
      >
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <span style={s.groupLabel}>{t(`smartDiff.${ROLE_LABEL_KEY[group.role]}`)}</span>
        <span style={s.groupMeta}>{t("smartDiff.filesCount", { count: files.length })}</span>
        {findingLines > 0 && (
          <span style={s.groupMeta}>{t("smartDiff.findingLines", { count: findingLines })}</span>
        )}
      </div>
      {open && (
        <div style={s.groupBody}>
          <DiffViewer files={files} commenting={commenting} fileMeta={fileMeta} />
        </div>
      )}
    </div>
  );
}

export function SmartDiffViewer({
  prId,
  files,
  commenting,
}: {
  prId: string | null;
  files: PrFile[];
  commenting?: DiffCommentApi;
}) {
  const t = useTranslations("prReview");
  const { data, isLoading, isError } = usePrSmartDiff(prId);

  if (isLoading) {
    return (
      <div style={s.skeletonWrap}>
        <Skeleton height={32} width={220} />
        <Skeleton height={140} />
        <Skeleton height={140} />
      </div>
    );
  }

  const totalGrouped = data?.groups.reduce((n, g) => n + g.files.length, 0) ?? 0;
  if (isError || !data || totalGrouped === 0) {
    return <DiffViewer files={files} commenting={commenting} />;
  }

  const fileMeta = buildFileMeta(data.groups);
  const grouped = groupFiles(data.groups, files);
  const leftover = ungroupedFiles(data.groups, files);

  return (
    <div style={s.wrap}>
      <SectionLabel icon="Layers">{t("smartDiff.groupedByRole")}</SectionLabel>

      {data.split_suggestion.too_big && (
        <div style={s.banner}>
          <div style={s.bannerTitle}>
            {t("smartDiff.largeTitle", { lines: data.split_suggestion.total_lines })}
          </div>
          <div style={s.bannerBody}>{t("smartDiff.largeBody")}</div>
          {data.split_suggestion.proposed_splits.length > 0 && (
            <ul style={s.splitList}>
              {data.split_suggestion.proposed_splits.map((split, i) => (
                // Index, not `split.name` — the server tries to keep names
                // unique but a directory literally named "chore" can still
                // collide with the boilerplate split's name; a duplicate key
                // must never be possible here.
                <li key={i} style={s.splitItem}>
                  <span style={s.splitName}>{split.name}</span>
                  <span style={s.splitFiles}>{split.files.join(", ")}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {grouped
        .filter((g) => g.files.length > 0)
        .map((g) => (
          <RoleGroup
            key={g.role}
            group={data.groups.find((sg) => sg.role === g.role)!}
            files={g.files}
            fileMeta={fileMeta}
            commenting={commenting}
            t={t}
          />
        ))}

      {leftover.length > 0 && (
        <div style={s.group}>
          <div style={s.groupHeaderStatic}>
            <span style={s.groupLabel}>{t("smartDiff.ungroupedTitle")}</span>
            <span style={s.groupMeta}>{t("smartDiff.filesCount", { count: leftover.length })}</span>
          </div>
          <div style={s.groupBody}>
            <DiffViewer files={leftover} commenting={commenting} />
          </div>
        </div>
      )}
    </div>
  );
}
