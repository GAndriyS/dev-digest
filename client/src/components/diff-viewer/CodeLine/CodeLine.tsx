/* CodeLine — one rendered diff line: gutter number, +/- sign, text, plus the
   hover "+" affordance, any anchored comment threads, an inline composer, and
   any Smart-Diff finding annotations. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { Severity } from "@/lib/types";
import type { DiffLineAnnotation } from "../DiffViewer";
import { commentTargetFor, type CommentThread, type DiffCommentApi, cs } from "../comments";
import { type Line } from "../helpers";
import { s, lineRowFor, lineSignFor, annotationChip } from "../styles";
import { CommentThreadView } from "../CommentThreadView";
import { InlineComposer } from "../InlineComposer";

/** Icon per contract severity — matches the vendored severity tokens
    (`vendor/ui/primitives/tokens.ts`), but their English labels are
    hardcoded there, so labels come from `shell.diffViewer.*` instead. */
const SEVERITY_ICON: Record<Severity, typeof Icon.AlertTriangle> = {
  CRITICAL: Icon.AlertOctagon,
  WARNING: Icon.AlertTriangle,
  SUGGESTION: Icon.Lightbulb,
};

/** i18n key per severity for the chip's visible label and its aria-label. */
const SEVERITY_LABEL_KEY: Record<Severity, "annotationBlocker" | "annotationWarning" | "annotationSuggestion"> = {
  CRITICAL: "annotationBlocker",
  WARNING: "annotationWarning",
  SUGGESTION: "annotationSuggestion",
};

export function CodeLine({
  ln,
  path,
  threads,
  commenting,
  annotations,
  onFindingClick,
}: {
  ln: Line;
  path: string;
  threads: CommentThread[];
  commenting?: DiffCommentApi;
  /** Findings landing on this rendered line (already snapped + sorted
      CRITICAL → WARNING → SUGGESTION by `FileCard`). Absent/empty renders no
      chips and leaves the row's normal add/del tint. */
  annotations?: DiffLineAnnotation[];
  onFindingClick?: (findingId: string) => void;
}) {
  const t = useTranslations("shell");
  const [hover, setHover] = React.useState(false);
  const [composing, setComposing] = React.useState(false);

  if (ln.kind === "hunk") {
    return (
      <div className="mono" style={s.hunk}>
        {ln.text}
      </div>
    );
  }

  const sign = ln.kind === "add" ? "+" : ln.kind === "del" ? "−" : "";
  const target = commenting?.canComment ? commentTargetFor(ln) : null;
  const showAdd = hover && !!target && !composing;
  const hasAnnotations = !!annotations && annotations.length > 0;
  // Callers pre-sort each line's annotations CRITICAL → WARNING → SUGGESTION,
  // so the first entry is the highest-priority one — that's what stripes the row.
  const rowSeverity = hasAnnotations ? annotations![0]!.severity : undefined;

  return (
    <div
      data-line={ln.newNo}
      style={hasAnnotations ? { ...cs.rowWrap, scrollMarginTop: 16 } : cs.rowWrap}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={lineRowFor(ln.kind, rowSeverity)}>
        <span className="mono tnum" style={{ ...s.lineNo, position: "relative" }}>
          {showAdd && target && (
            <button
              type="button"
              title="Add a comment on this line"
              aria-label="Add a comment on this line"
              onClick={() => setComposing(true)}
              style={cs.addBtn}
            >
              +
            </button>
          )}
          {ln.newNo ?? ln.oldNo ?? ""}
        </span>
        <span className="mono" style={lineSignFor(ln.kind)}>
          {sign}
        </span>
        <span className="mono" style={s.lineText}>
          {ln.text || " "}
        </span>
        {hasAnnotations && (
          <span style={s.annotationsCell}>
            {annotations!.map((a) => {
              const SevIcon = SEVERITY_ICON[a.severity];
              const label = t(`diffViewer.${SEVERITY_LABEL_KEY[a.severity]}`);
              return (
                <button
                  key={a.findingId}
                  type="button"
                  onClick={() => onFindingClick?.(a.findingId)}
                  aria-label={t("diffViewer.annotationAria", { label })}
                  style={annotationChip(a.severity)}
                >
                  <SevIcon size={11} />
                  {label}
                </button>
              );
            })}
          </span>
        )}
      </div>

      {commenting &&
        commenting.showComments &&
        threads.map((th) => (
          <CommentThreadView key={th.rootId} thread={th} commenting={commenting} path={path} />
        ))}

      {commenting && composing && target && (
        <InlineComposer
          commenting={commenting}
          path={path}
          line={target.line}
          side={target.side}
          onClose={() => setComposing(false)}
        />
      )}
    </div>
  );
}
