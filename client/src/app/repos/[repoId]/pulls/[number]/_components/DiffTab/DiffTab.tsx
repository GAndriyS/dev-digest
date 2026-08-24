"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Button } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import { SmartDiffViewer } from "../SmartDiffViewer";
import { usePrComments, useCreatePrComment } from "@/lib/hooks/reviews";
import { notify } from "@/lib/toast";
import type { FindingRecord, PrFile } from "@devdigest/shared";
import { targetFileMeta } from "../SmartDiffViewer/helpers";
import {
  DEFAULT_DIFF_VIEW,
  DIFF_VIEWS,
  SCROLL_SETTLE_MAX_FRAMES,
  SEGMENT_ARROW_KEYS,
  type DiffView,
} from "./constants";
import { s } from "./styles";

/** Both orders in ONE control: a two-segment pill whose highlight slides to the
    selected side. A radiogroup rather than two buttons — a screen reader then
    announces "Diff order, Smart order, 1 of 2", one control with two options,
    which is what the pill draws; two buttons would be two controls that merely
    look joined. Only the selected segment is tabbable, so the group is a single
    tab stop and the arrow keys move within it.

    The segments share a width (two equal grid columns), which is what lets the
    highlight be a plain 50%-wide element translated by its own width: no
    measuring on mount, and nothing to re-measure when the labels are
    translated or the font loads. */
function OrderSwitch({ value, onChange }: { value: DiffView; onChange: (view: DiffView) => void }) {
  const t = useTranslations("prReview");
  const label: Record<DiffView, string> = {
    smart: t("smartDiff.viewSmart"),
    original: t("smartDiff.viewOriginal"),
  };
  const segments = React.useRef(new Map<DiffView, HTMLButtonElement | null>());

  function onKeyDown(e: React.KeyboardEvent) {
    if (!SEGMENT_ARROW_KEYS.includes(e.key)) return;
    e.preventDefault(); // arrows scroll the diff otherwise
    const next = value === DIFF_VIEWS[0] ? DIFF_VIEWS[1] : DIFF_VIEWS[0];
    onChange(next);
    segments.current.get(next)?.focus();
  }

  return (
    <div style={s.order} role="radiogroup" aria-label={t("smartDiff.viewOrderLabel")} onKeyDown={onKeyDown}>
      {/* Decoration: the selected state is on the segments' aria-checked, so the
          highlight is hidden from assistive tech rather than described twice. */}
      <span
        aria-hidden="true"
        style={{ ...s.orderThumb, ...(value === DIFF_VIEWS[0] ? null : s.orderThumbEnd) }}
      />
      {DIFF_VIEWS.map((view) => (
        <button
          key={view}
          ref={(el) => {
            segments.current.set(view, el);
          }}
          type="button"
          role="radio"
          aria-checked={value === view}
          tabIndex={value === view ? 0 : -1}
          onClick={() => onChange(view)}
          style={{ ...s.orderSegment, ...(value === view ? s.orderSegmentOn : null) }}
        >
          {label[view]}
        </button>
      ))}
    </div>
  );
}

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
  /** Already-loaded findings across every review of this PR (`usePrReviews`,
      fetched by the page) — joined onto the diff client-side so annotating
      lines never costs a new request. */
  findings: FindingRecord[];
  /** Navigates to a finding's card in the Agent runs tab. Required, not
      optional: an unsoldered seam with the caller must fail typecheck rather
      than silently drop clicks. */
  onOpenFinding: (findingId: string) => void;
  /** Repo-relative path to expand and scroll into view on mount — the page's
      `?file=` (SPEC-04 AC-34/AC-35), forwarded from a ReviewFocusPanel row
      via `OverviewTab`. When set, this tab renders the flat
      `DiffViewer` directly instead of `SmartDiffViewer` (R3/Amendment A3 —
      see `targetFileMeta` in `SmartDiffViewer/helpers.ts`), so Smart order's
      own grouped `fileMeta` is never a second writer of `defaultOpen` for
      this path. Absent/null: ordinary Smart-order default, unaffected. */
  targetPath?: string | null;
}

export function DiffTab({
  prId,
  filesCount,
  files,
  canComment,
  findings,
  onOpenFinding,
  targetPath = null,
}: DiffTabProps) {
  const t = useTranslations("prReview");
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);
  // Lazy initializer: a `targetPath` lands directly on Original order instead
  // of flashing Smart order first — DiffTab remounts on every tab switch (the
  // page conditionally renders it), so "on mount" is the only time this needs
  // deciding.
  const [view, setView] = React.useState<DiffView>(() => (targetPath ? "original" : DEFAULT_DIFF_VIEW));

  // Scroll the target file into view once it's rendered. A single
  // `scrollIntoView` undershoots here: neighbouring FileCards above the
  // target are still expanding for several frames after mount, which keeps
  // moving the target's document position out from under a one-shot scroll
  // (client/INSIGHTS.md — same pattern as FindingsPanel's `?finding=`
  // target). Re-scroll every frame until the element's DOCUMENT offset holds
  // still, with a frame cap so a genuinely never-settling layout stops
  // rather than spins.
  const diffRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!targetPath) return;
    const documentTop = (el: HTMLElement) => {
      let y = 0;
      for (let n: HTMLElement | null = el; n; n = n.offsetParent as HTMLElement | null) y += n.offsetTop;
      return y;
    };
    // FileCard renders the path as literal text (`.mono`) inside its header —
    // no `data-*` anchor exists on it (that component isn't owned by this
    // change), so an exact text match scoped to this tab's own diff area is
    // the anchor. `closest("div")` climbs from the text span to its header
    // row, a taller, more legible target to land the viewport on.
    const findTarget = (): HTMLElement | null => {
      const root = diffRef.current;
      if (!root) return null;
      for (const el of root.querySelectorAll<HTMLElement>("span.mono")) {
        if (el.textContent === targetPath) return (el.closest("div") as HTMLElement | null) ?? el;
      }
      return null;
    };
    let raf = 0;
    let lastTop = Number.NaN;
    let stableFrames = 0;
    let frames = 0;
    const tick = () => {
      const el = findTarget();
      if (el) {
        const top = documentTop(el);
        el.scrollIntoView({ block: "center" });
        stableFrames = top === lastTop ? stableFrames + 1 : 0;
        lastTop = top;
      }
      if (stableFrames < 2 && ++frames < SCROLL_SETTLE_MAX_FRAMES) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [targetPath]);

  const commentCount = comments?.length ?? 0;

  const totals = React.useMemo(
    () =>
      files.reduce(
        (acc, f) => ({ additions: acc.additions + f.additions, deletions: acc.deletions + f.deletions }),
        { additions: 0, deletions: 0 },
      ),
    [files],
  );

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  return (
    <section>
      <div style={s.header}>
        <div style={s.headerTop}>
          <div style={s.headerLabel}>
            <Icon.Code size={14} style={s.headerIcon} />
            <span style={s.headerLabelText}>{t("smartDiff.headerLabel")}</span>
          </div>
          <div style={s.headerActions}>
            <OrderSwitch value={view} onChange={setView} />
            {commentCount > 0 && (
              <Button
                kind="ghost"
                size="sm"
                icon={showComments ? "EyeOff" : "Eye"}
                onClick={() => setShowComments((v) => !v)}
              >
                {showComments ? t("smartDiff.hideComments") : t("smartDiff.showComments")} ({commentCount})
              </Button>
            )}
          </div>
        </div>
        <div style={s.headerStats}>
          <span>{t("smartDiff.headerStats", { count: filesCount })}</span>
          <span className="mono tnum">
            <span style={s.addText}>+{totals.additions}</span>{" "}
            <span style={s.delText}>−{totals.deletions}</span>
          </span>
        </div>
      </div>
      <div ref={diffRef}>
        {view === "original" ? (
          // `fileMeta` is empty unless a `?file=` target is active — Original
          // order otherwise carries "no annotations" structurally, not via a
          // conditional inside the viewer.
          <DiffViewer
            files={files}
            commenting={commenting}
            fileMeta={targetPath ? targetFileMeta(targetPath) : undefined}
          />
        ) : (
          <SmartDiffViewer
            prId={prId}
            files={files}
            findings={findings}
            commenting={commenting}
            onOpenFinding={onOpenFinding}
          />
        )}
      </div>
    </section>
  );
}
