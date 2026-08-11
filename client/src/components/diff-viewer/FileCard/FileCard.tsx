/* FileCard — one collapsible file in the diff: header (path, +/- stat, comment
   count) and, when open, its parsed lines plus any outdated comments. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { PrFile } from "@/lib/types";
import { AUTO_EXPAND_MAX_LINES } from "../constants";
import { parsePatch, type Line } from "../helpers";
import {
  buildThreads,
  keysForLine,
  partitionThreads,
  type CommentThread,
  type DiffCommentApi,
} from "../comments";
import { s, chevronFor } from "../styles";
import { CodeLine } from "../CodeLine";
import { OutdatedComments } from "../OutdatedComments";

/** Threads anchored to a given parsed line (RIGHT=new, LEFT=old). */
function threadsForLine(ln: Line, matched: Map<string, CommentThread[]>): CommentThread[] {
  if (matched.size === 0) return [];
  const out: CommentThread[] = [];
  for (const key of keysForLine(ln)) {
    const list = matched.get(key);
    if (list) out.push(...list);
  }
  return out;
}

export function FileCard({
  file,
  commenting,
  defaultOpen,
  findingLines,
}: {
  file: PrFile;
  commenting?: DiffCommentApi;
  /** Overrides the size heuristic below (Smart Diff: a lock file always starts
      collapsed regardless of its line count). `undefined` leaves the heuristic. */
  defaultOpen?: boolean;
  /** New-side (`Line.newNo`) line numbers to badge + jump to, from Smart Diff's
      findings. Absent/empty renders no badge. */
  findingLines?: number[];
}) {
  const t = useTranslations("shell");
  const [open, setOpen] = React.useState(
    defaultOpen ?? (file.additions ?? 0) + (file.deletions ?? 0) <= AUTO_EXPAND_MAX_LINES
  );
  const lines = React.useMemo(() => parsePatch(file.patch), [file.patch]);
  const findingLineSet = React.useMemo(() => new Set(findingLines ?? []), [findingLines]);

  // Clicking the finding badge opens the card and scrolls to a finding line,
  // cycling through them on repeat clicks (ref-held index, no re-render needed
  // for the cycle position itself). Scroll is two-phase: `open` flips first (so
  // the body — and its `data-line` rows — exists), then an effect (which runs
  // after that DOM commit) does the actual scrollIntoView, keyed by a nonce so
  // clicking the SAME line twice in a row still re-fires the scroll.
  const findingCycleRef = React.useRef(0);
  const scrollNonceRef = React.useRef(0);
  const [scrollTarget, setScrollTarget] = React.useState<{ line: number; nonce: number } | null>(
    null
  );
  const bodyRef = React.useRef<HTMLDivElement | null>(null);

  const jumpToFinding = () => {
    if (!findingLines || findingLines.length === 0) return;
    const idx = findingCycleRef.current % findingLines.length;
    const line = findingLines[idx]!;
    findingCycleRef.current = idx + 1;
    scrollNonceRef.current += 1;
    setOpen(true);
    setScrollTarget({ line, nonce: scrollNonceRef.current });
  };

  React.useEffect(() => {
    if (!scrollTarget) return;
    const el = bodyRef.current?.querySelector<HTMLElement>(`[data-line="${scrollTarget.line}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollTarget?.nonce]);

  // Group this file's comments into threads, then split into ones we can anchor
  // to a rendered line vs. "outdated" (GitHub dropped the line / it's not here).
  const comments = commenting?.comments;
  const { matched, outdated } = React.useMemo(() => {
    if (!comments) return { matched: new Map<string, CommentThread[]>(), outdated: [] };
    const fileThreads = buildThreads(comments.filter((c) => c.path === file.path));
    const renderedKeys = new Set<string>();
    for (const ln of lines) for (const k of keysForLine(ln)) renderedKeys.add(k);
    return partitionThreads(fileThreads, renderedKeys);
  }, [comments, file.path, lines]);

  const commentCount = commenting
    ? commenting.comments.filter((c) => c.path === file.path).length
    : 0;

  return (
    <div style={s.fileCard}>
      <div onClick={() => setOpen((o) => !o)} style={s.fileHeader}>
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <Icon.FileText size={14} style={s.fileIcon} />
        <span className="mono" style={s.filePath}>
          {file.path}
        </span>
        <span className="mono tnum" style={s.fileStat}>
          <span style={s.addText}>+{file.additions}</span>{" "}
          <span style={s.delText}>−{file.deletions}</span>
        </span>
        {commentCount > 0 && (
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-muted)" }}
          >
            <Icon.MessageSquare size={12} />
            {commentCount}
          </span>
        )}
        {findingLines && findingLines.length > 0 && (
          <span
            role="button"
            tabIndex={0}
            aria-label={t("diffViewer.findingsJumpAria", { count: findingLines.length })}
            onClick={(e) => {
              e.stopPropagation();
              jumpToFinding();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                jumpToFinding();
              }
            }}
            style={s.findingBadge}
          >
            <Icon.AlertTriangle size={12} />
            {findingLines.length}
          </span>
        )}
      </div>
      {open && (
        <div ref={bodyRef} style={s.fileBody}>
          {lines.length === 0 ? (
            <div style={s.noDiff}>{t("diffViewer.noDiffText")}</div>
          ) : (
            lines.map((ln, i) => (
              <CodeLine
                key={i}
                ln={ln}
                path={file.path}
                threads={threadsForLine(ln, matched)}
                commenting={commenting}
                highlighted={ln.newNo != null && findingLineSet.has(ln.newNo)}
              />
            ))
          )}
          {commenting && commenting.showComments && <OutdatedComments threads={outdated} />}
        </div>
      )}
    </div>
  );
}
