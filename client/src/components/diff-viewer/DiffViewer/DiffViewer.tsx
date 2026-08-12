/* DiffViewer — basic GitHub-style unified diff viewer. Renders real PrFile.patch
   (unified-diff text from the F1 API) as a list of collapsible FileCards.
   Optional inline comments (Files changed tab): hover a line → "+" → comment,
   posted live to GitHub; existing GitHub review comments render inline. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { PrFile, Severity } from "@/lib/types";
import { type DiffCommentApi } from "../comments";
import { s } from "../styles";
import { FileCard } from "../FileCard";

/** One finding rendered as an annotation on a diff line — id for navigation,
    new-side line number to anchor to (`Line.newNo`), and the contract
    `Severity` (never the UI kit's, which adds an `INFO` member the API can't
    produce — see client/INSIGHTS.md). The caller (Smart Diff) computes these
    from findings it already has; the diff viewer never fetches or joins. */
export interface DiffLineAnnotation {
  findingId: string;
  line: number;
  severity: Severity;
}

/** Per-path overrides a caller (e.g. Smart Diff) hands in as props — the diff
    viewer never reaches into `src/app/**` to compute these itself. */
export interface DiffFileMeta {
  defaultOpen?: boolean;
  annotations?: DiffLineAnnotation[];
}

export function DiffViewer({
  files,
  commenting,
  fileMeta,
  onFindingClick,
}: {
  files: PrFile[];
  commenting?: DiffCommentApi;
  fileMeta?: Record<string, DiffFileMeta>;
  /** Called with a finding's id when its annotation (or a file's finding
      badge) is clicked — navigation to the Agent runs tab is the caller's
      job, not this component's. */
  onFindingClick?: (findingId: string) => void;
}) {
  const t = useTranslations("shell");
  if (!files || files.length === 0) {
    return <div style={s.empty}>{t("diffViewer.noChangedFiles")}</div>;
  }
  return (
    <div style={s.list}>
      {files.map((f) => {
        const meta = fileMeta?.[f.path];
        return (
          <FileCard
            key={f.path}
            file={f}
            commenting={commenting}
            defaultOpen={meta?.defaultOpen}
            annotations={meta?.annotations}
            onFindingClick={onFindingClick}
          />
        );
      })}
    </div>
  );
}
