/* SeverityCounters — the ⊘2 ⚠1 💡3 breakdown shown on PR rows and on timeline
   run rows. Severities with no findings are omitted entirely; when every count
   is zero the component renders nothing so callers can show their own em dash.
   Clicking a counter selects that severity (the caller decides what "selected"
   means: a filter on the detail page, a deep link from the list).

   Hovering previews the findings themselves, when the caller supplies them —
   either directly (the detail page already has them in memory) or lazily via
   `onFindingsHoverStart` (the PR list fetches on first hover). With neither
   prop the counters stay inert, exactly as before. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SeverityBadge, type Severity as UiSeverity } from "@devdigest/ui";
import type { FindingRecord, Severity } from "@devdigest/shared";
import { SEVERITY_KEYS } from "./constants";
import { s } from "./styles";
import { FindingsPopover } from "./FindingsPopover";
import { useHoverIntent } from "./useHoverIntent";
import { placePopover } from "./popoverHelpers";

export interface SeverityCountsView {
  critical: number;
  warning: number;
  suggestion: number;
}

export function SeverityCounters({
  counts,
  active,
  onSelect,
  findings,
  findingsLoading,
  onFindingsHoverStart,
}: {
  counts: SeverityCountsView;
  /** Highlight this severity and dim the others. */
  active?: Severity | null;
  onSelect?: (severity: Severity) => void;
  /** Provide (or promise, via onFindingsHoverStart) findings to enable the hover card. */
  findings?: FindingRecord[];
  findingsLoading?: boolean;
  /** Called on first hover — lets a caller start loading `findings` lazily. */
  onFindingsHoverStart?: () => void;
}) {
  const t = useTranslations("prReview");
  const wrapRef = React.useRef<HTMLSpanElement | null>(null);
  const [position, setPosition] = React.useState<React.CSSProperties | null>(null);
  const popoverId = React.useId();

  const hoverable = findings !== undefined || onFindingsHoverStart !== undefined;
  const hover = useHoverIntent({ onHoverStart: onFindingsHoverStart });
  const { open, close } = hover;

  // Anchor to the trigger's viewport position at open time. Recomputing on
  // scroll would mean tracking the scroll of every ancestor; closing is both
  // simpler and what the cursor is about to cause anyway.
  React.useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    setPosition(placePopover(rect, { width: window.innerWidth, height: window.innerHeight }));
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, close]);

  const shown = SEVERITY_KEYS.filter(({ countKey }) => counts[countKey] > 0);
  if (shown.length === 0) return null;

  const total = counts.critical + counts.warning + counts.suggestion;
  const popoverOpen = hoverable && open && position !== null;

  return (
    <span
      ref={wrapRef}
      style={s.wrap}
      aria-describedby={popoverOpen ? popoverId : undefined}
      {...(hoverable ? hover.triggerProps : {})}
    >
      {shown.map(({ severity, countKey }) => {
        const count = counts[countKey];
        const selected = active === severity;
        const label = t(`severityCounters.${countKey}`, { count });
        return (
          <button
            key={severity}
            type="button"
            // The native tooltip is suppressed when the hover card is wired up:
            // the browser renders it above everything, on its own delay, and it
            // lands right on top of the card. `aria-label` still names the chip.
            title={hoverable ? undefined : label}
            aria-label={label}
            aria-pressed={onSelect ? selected : undefined}
            disabled={!onSelect}
            onClick={(e) => {
              // Both mount points sit inside their own clickable row.
              e.stopPropagation();
              onSelect?.(severity);
            }}
            style={s.chip(!!onSelect, !!active && !selected, selected)}
          >
            <SeverityBadge severity={severity as UiSeverity} count={count} compact />
          </button>
        );
      })}
      {popoverOpen && (
        <FindingsPopover
          id={popoverId}
          findings={findings}
          loading={findingsLoading}
          total={total}
          position={position}
          onMouseEnter={hover.popoverProps.onMouseEnter}
          onMouseLeave={hover.popoverProps.onMouseLeave}
        />
      )}
    </span>
  );
}
