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
import { Icon, Skeleton } from "@devdigest/ui";
import type { FindingRecord, PrFile, SmartDiffGroup } from "@devdigest/shared";
import { DiffViewer, type DiffCommentApi, type DiffFileMeta } from "@/components/diff-viewer";
import { usePrSmartDiff } from "@/lib/hooks/reviews";
import {
  buildAnnotations,
  buildFileMeta,
  groupFiles,
  ungroupedFiles,
  type FileMetaEntry,
} from "./helpers";
import { DEFAULT_OPEN_BY_ROLE, ROLE_DESC_KEY, ROLE_LABEL_KEY, ROLE_MARKER_COLOR } from "./constants";
import { s, chevronFor, groupMarker } from "./styles";

/** One collapsible role group — header (colour marker, role label, muted
    description, file count) plus its files rendered through the shared
    DiffViewer, which is also what applies each file's `defaultOpen`/
    `annotations` override and forwards clicks on a line's annotation. */
function RoleGroup({
  group,
  files,
  fileMeta,
  commenting,
  onFindingClick,
  t,
}: {
  group: SmartDiffGroup;
  files: PrFile[];
  fileMeta: Record<string, FileMetaEntry>;
  commenting?: DiffCommentApi;
  onFindingClick: (findingId: string) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  // `null` in DEFAULT_OPEN_BY_ROLE means "no group-level opinion" — the group
  // opens and each FileCard's own size heuristic decides. Only `boilerplate`
  // names a value, and it closes the group itself, not just the files inside:
  // a lock file whose path is still on screen has not been got out of the way.
  const [open, setOpen] = React.useState(DEFAULT_OPEN_BY_ROLE[group.role] ?? true);

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
        <span style={groupMarker(ROLE_MARKER_COLOR[group.role])} />
        <div style={s.groupHeaderText}>
          <span style={s.groupLabel}>{t(`smartDiff.${ROLE_LABEL_KEY[group.role]}`)}</span>
          <span style={s.groupDesc}>{t(`smartDiff.${ROLE_DESC_KEY[group.role]}`)}</span>
        </div>
        <span style={s.groupMeta}>{t("smartDiff.filesCount", { count: files.length })}</span>
      </div>
      {open && (
        <div style={s.groupBody}>
          <DiffViewer files={files} commenting={commenting} fileMeta={fileMeta} onFindingClick={onFindingClick} />
        </div>
      )}
    </div>
  );
}

export function SmartDiffViewer({
  prId,
  files,
  findings,
  commenting,
  onOpenFinding,
}: {
  prId: string | null;
  files: PrFile[];
  findings: FindingRecord[];
  commenting?: DiffCommentApi;
  onOpenFinding: (findingId: string) => void;
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

  const annotationsByPath = buildAnnotations(files, findings);

  const totalGrouped = data?.groups.reduce((n, g) => n + g.files.length, 0) ?? 0;
  if (isError || !data || totalGrouped === 0) {
    // Ranking failed or hasn't run yet — still fall back to the plain viewer,
    // but the annotations a review already produced are real data, not part
    // of the ranking that failed, so they render here too (no `defaultOpen`:
    // that override is a ranking opinion this branch doesn't have).
    const fallbackMeta: Record<string, DiffFileMeta> = {};
    for (const [path, annotations] of Object.entries(annotationsByPath)) {
      fallbackMeta[path] = { annotations };
    }
    return (
      <DiffViewer files={files} commenting={commenting} fileMeta={fallbackMeta} onFindingClick={onOpenFinding} />
    );
  }

  const fileMeta = buildFileMeta(data.groups, annotationsByPath);
  const grouped = groupFiles(data.groups, files);
  const leftover = ungroupedFiles(data.groups, files);
  // A ranking gap doesn't have a role's `defaultOpen` opinion, but a file
  // here can still carry real annotations — same rule as the fallback branch.
  for (const f of leftover) {
    if (annotationsByPath[f.path]) fileMeta[f.path] = { annotations: annotationsByPath[f.path] };
  }

  return (
    <div style={s.wrap}>
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
            onFindingClick={onOpenFinding}
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
            <DiffViewer files={leftover} commenting={commenting} fileMeta={fileMeta} onFindingClick={onOpenFinding} />
          </div>
        </div>
      )}
    </div>
  );
}
