/* FindingsPopover — the card shown when hovering the severity counters. A
   preview, not a replacement for the findings list: worst findings first, capped,
   with the rest rolled into "and N more".

   Purely presentational. It never fetches: the detail page already holds the
   findings in memory, and the PR list arms a lazy query one level up, so both
   mount points just hand over an array. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  CategoryTag,
  ConfidenceNum,
  Icon,
  SeverityBadge,
  Skeleton,
  type Category,
  type Severity as UiSeverity,
} from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { pop } from "./styles";
import { POPOVER_LIMIT, sortForPopover, stripMarkdownInline } from "./popoverHelpers";

/** "11" for a single line, "11-15" for a range — same format as FindingCard. */
function lineLabel(f: Pick<FindingRecord, "start_line" | "end_line">): string {
  return f.start_line === f.end_line ? `${f.start_line}` : `${f.start_line}-${f.end_line}`;
}

export function FindingsPopover({
  id,
  findings,
  loading,
  total,
  position,
  onMouseEnter,
  onMouseLeave,
}: {
  id: string;
  /** Undefined while the caller has not loaded them yet. */
  findings: FindingRecord[] | undefined;
  loading?: boolean;
  /** Header count — the sum of the chips, so the two can never disagree. */
  total: number;
  position: React.CSSProperties;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const t = useTranslations("prReview");
  const shown = findings ? sortForPopover(findings).slice(0, POPOVER_LIMIT) : [];
  const hidden = findings ? findings.length - shown.length : 0;

  return (
    <div
      id={id}
      role="tooltip"
      style={pop.panel(position)}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div style={pop.header}>
        <Icon.Info size={13} />
        {t("severityCounters.popoverTitle", { count: total })}
      </div>

      {findings === undefined || loading ? (
        <>
          {Array.from({ length: Math.min(total, POPOVER_LIMIT) || 1 }, (_, i) => (
            <div key={i} style={pop.skeletonRow}>
              <Skeleton width="70%" height={13} />
              <Skeleton width="45%" height={11} />
            </div>
          ))}
        </>
      ) : (
        <>
          {shown.map((f, i) => (
            <div key={f.id} style={pop.row(i === 0)}>
              <div style={pop.badgeWrap}>
                <SeverityBadge severity={f.severity as UiSeverity} compact />
              </div>
              <div style={pop.rowMain}>
                <div style={pop.titleRow}>
                  <span style={pop.title(!!f.dismissed_at)}>{f.title}</span>
                  <CategoryTag category={f.category as Category} />
                </div>
                <div style={pop.metaRow}>
                  <span className="mono" style={pop.file}>
                    {f.file}:{lineLabel(f)}
                  </span>
                  <ConfidenceNum value={f.confidence} />
                </div>
                <div style={pop.rationale}>{stripMarkdownInline(f.rationale)}</div>
              </div>
            </div>
          ))}
          {hidden > 0 && (
            <div style={pop.more}>{t("severityCounters.popoverMore", { count: hidden })}</div>
          )}
        </>
      )}
    </div>
  );
}
