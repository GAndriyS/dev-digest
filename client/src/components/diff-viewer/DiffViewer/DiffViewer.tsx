/* DiffViewer — basic GitHub-style unified diff viewer. Renders real PrFile.patch
   (unified-diff text from the F1 API) as a list of collapsible FileCards.
   Optional inline comments (Files changed tab): hover a line → "+" → comment,
   posted live to GitHub; existing GitHub review comments render inline. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { PrFile } from "@/lib/types";
import { type DiffCommentApi } from "../comments";
import { s } from "../styles";
import { FileCard } from "../FileCard";

/** Per-path overrides a caller (e.g. Smart Diff) hands in as props — the diff
    viewer never reaches into `src/app/**` to compute these itself. */
export interface DiffFileMeta {
  defaultOpen?: boolean;
  findingLines?: number[];
}

export function DiffViewer({
  files,
  commenting,
  fileMeta,
}: {
  files: PrFile[];
  commenting?: DiffCommentApi;
  fileMeta?: Record<string, DiffFileMeta>;
}) {
  const t = useTranslations("shell");
  if (!files || files.length === 0) {
    return <div style={s.empty}>{t("diffViewer.noChangedFiles")}</div>;
  }
  return (
    <div style={s.list}>
      {files.map((f, i) => {
        const meta = fileMeta?.[f.path];
        return (
          <FileCard
            key={i}
            file={f}
            commenting={commenting}
            defaultOpen={meta?.defaultOpen}
            findingLines={meta?.findingLines}
          />
        );
      })}
    </div>
  );
}
