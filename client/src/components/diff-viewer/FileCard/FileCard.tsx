/* FileCard — one collapsible file in the diff: header (path, +/- stat, comment
   count) and, when open, its parsed lines plus any outdated comments. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { PrFile, Severity } from "@/lib/types";
import type { DiffLineAnnotation } from "../DiffViewer";
import { AUTO_EXPAND_MAX_LINES } from "../constants";
import { parsePatch, type Line } from "../helpers";
import {
  buildThreads,
  keysForLine,
  partitionThreads,
  type CommentThread,
  type DiffCommentApi,
} from "../comments";
import { s, chevronFor, findingBadgeFor } from "../styles";
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

/** Nearest rendered new-side line at or after `target`. A finding's
    `start_line` can fall on a deleted line or outside every hunk in the
    stored patch — `CodeLine` only renders `data-line` for lines that have a
    `newNo` (see its component), so an exact match may not exist. Falls back
    to the last rendered line when nothing at or after `target` exists, so an
    annotation always lands somewhere; `undefined` only when the file renders
    no lines at all (`renderedNewNos` sorted ascending). */
function nearestRenderedLine(target: number, renderedNewNos: number[]): number | undefined {
  for (const n of renderedNewNos) {
    if (n >= target) return n;
  }
  return renderedNewNos[renderedNewNos.length - 1];
}

/** Fixed display/priority order for annotations sharing a line or a badge:
    CRITICAL → WARNING → SUGGESTION (decision 13, l03-subagents-smart-diff-v2). */
const SEVERITY_RANK: Record<Severity, number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 };

function bySeverity(a: DiffLineAnnotation, b: DiffLineAnnotation): number {
  return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
}

/** Highest-priority severity across a set of annotations (CRITICAL wins) —
    drives the header badge's colour. */
function worstSeverity(list: DiffLineAnnotation[]): Severity {
  return list.reduce<Severity>(
    (worst, a) => (SEVERITY_RANK[a.severity] < SEVERITY_RANK[worst] ? a.severity : worst),
    list[0]!.severity,
  );
}

export function FileCard({
  file,
  commenting,
  defaultOpen,
  annotations,
  onFindingClick,
}: {
  file: PrFile;
  commenting?: DiffCommentApi;
  /** Overrides the size heuristic below (Smart Diff: a lock file always starts
      collapsed regardless of its line count). `undefined` leaves the heuristic. */
  defaultOpen?: boolean;
  /** Findings to render on their diff line, from Smart Diff's client-side join.
      Absent/empty renders no badge and no per-line chips. */
  annotations?: DiffLineAnnotation[];
  /** Called with a finding's id when its badge or an on-line annotation chip
      is clicked. */
  onFindingClick?: (findingId: string) => void;
}) {
  const t = useTranslations("shell");
  const totalLines = (file.additions ?? 0) + (file.deletions ?? 0);
  const isLarge = totalLines > AUTO_EXPAND_MAX_LINES;
  const [open, setOpen] = React.useState(defaultOpen ?? totalLines <= AUTO_EXPAND_MAX_LINES);
  const lines = React.useMemo(() => parsePatch(file.patch), [file.patch]);
  const renderedNewNos = React.useMemo(
    () => [...new Set(lines.map((l) => l.newNo).filter((n): n is number => n != null))].sort((a, b) => a - b),
    [lines]
  );

  // Each annotation snaps onto the nearest rendered line (its exact target
  // line may fall on a deleted line or a gap the stored patch never
  // rendered); annotations sharing a rendered line are ordered CRITICAL →
  // WARNING → SUGGESTION so the row's chips and the header badge agree.
  const annotationsByLine = React.useMemo(() => {
    const map = new Map<number, DiffLineAnnotation[]>();
    if (!annotations || annotations.length === 0 || renderedNewNos.length === 0) return map;
    for (const a of annotations) {
      const line = nearestRenderedLine(a.line, renderedNewNos);
      if (line == null) continue;
      const list = map.get(line) ?? [];
      list.push(a);
      map.set(line, list);
    }
    for (const list of map.values()) list.sort(bySeverity);
    return map;
  }, [annotations, renderedNewNos]);

  // The badge navigates to the first finding: lowest rendered line, then
  // (within that line) highest severity — decision 13.
  const firstFindingId = React.useMemo(() => {
    if (annotationsByLine.size === 0) return undefined;
    const firstLine = Math.min(...annotationsByLine.keys());
    return annotationsByLine.get(firstLine)![0]!.findingId;
  }, [annotationsByLine]);

  const handleBadgeActivate = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    if (firstFindingId) onFindingClick?.(firstFindingId);
  };

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
      <div
        onClick={() => setOpen((o) => !o)}
        style={isLarge ? { ...s.fileHeader, ...s.fileHeaderLarge } : s.fileHeader}
      >
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <Icon.FileText size={14} style={s.fileIcon} />
        <span className="mono" style={s.filePath}>
          {file.path}
        </span>
        <span className="mono tnum" style={s.fileStat}>
          <span style={s.addText}>+{file.additions}</span>{" "}
          <span style={s.delText}>−{file.deletions}</span>
        </span>
        {isLarge && (
          <span style={s.largeChip}>{t("diffViewer.largeFileChip", { count: totalLines })}</span>
        )}
        {commentCount > 0 && (
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-muted)" }}
          >
            <Icon.MessageSquare size={12} />
            {commentCount}
          </span>
        )}
        {annotations && annotations.length > 0 && (
          <span
            role="button"
            tabIndex={0}
            aria-label={t("diffViewer.findingsJumpAria", { count: annotations.length })}
            onClick={handleBadgeActivate}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleBadgeActivate(e);
              }
            }}
            style={findingBadgeFor(worstSeverity(annotations))}
          >
            <Icon.AlertTriangle size={12} />
            {annotations.length}
          </span>
        )}
      </div>
      {open && (
        <div style={s.fileBody}>
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
                annotations={ln.newNo != null ? annotationsByLine.get(ln.newNo) : undefined}
                onFindingClick={onFindingClick}
              />
            ))
          )}
          {commenting && commenting.showComments && <OutdatedComments threads={outdated} />}
        </div>
      )}
    </div>
  );
}
