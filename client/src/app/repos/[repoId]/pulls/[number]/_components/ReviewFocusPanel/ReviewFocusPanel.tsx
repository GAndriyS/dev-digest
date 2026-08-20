/* ReviewFocusPanel — SPEC-04 follow-up: region 3 of the Overview tab, full
   width, below region 2 (AC-56, AC-60). Sibling of `PrBriefCard/` (region 1)
   rather than a sub-component of it: the two blocks read the same brief but
   own nothing about each other's rendering (Decision 6 of the follow-up
   plan). Carries only the Review Focus header + count and the
   `review_focus[]` list — no Regenerate button, no stale badge, no
   generation error; those stay in region 1 (AC-61, AC-65, AC-67). The row
   markup below is carried over VERBATIM from the old
   `PrBriefCard`/region-1-and-3 card: `<button type="button">` stays a real
   button when `onOpenFile` is supplied AND the row's path is in
   `navigablePaths` (or `navigablePaths` is omitted — every row with
   `onOpenFile` is then treated as navigable), a static non-interactive `<div>`
   otherwise (AC-33, AC-34, AC-36). `reason` is untrusted model text, rendered
   as a plain React text node only (AC-44). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SectionLabel } from "@devdigest/ui";
import type { ReviewFocusItem } from "@devdigest/shared";
import { s } from "./styles";

export function ReviewFocusPanel({
  reviewFocus,
  onOpenFile,
  navigablePaths,
}: {
  reviewFocus: ReviewFocusItem[];
  /** Opens the Diff tab with this repo-relative path expanded and scrolled
      into view (AC-34). Optional: absent it, every row renders as
      non-interactive text instead of a control with nowhere to go. */
  onOpenFile?: (path: string) => void;
  /** Paths the Diff tab can actually show — the caller's current PR file
      list. A row renders as a `<button>` only when its path is in this set;
      when the set is omitted, every row with `onOpenFile` is treated as
      navigable. A row outside the set is never a button — not even a
      disabled-looking one — because the path it names cannot be shown
      (AC-36). */
  navigablePaths?: ReadonlySet<string>;
}) {
  const t = useTranslations("brief");

  return (
    <section>
      <SectionLabel
        icon="FileText"
        right={<span style={s.count}>{t("card.reviewFocusCount", { count: reviewFocus.length })}</span>}
      >
        {t("card.reviewFocusHeading")}
      </SectionLabel>

      {reviewFocus.length === 0 ? (
        <div style={s.muted}>{t("card.reviewFocusEmpty")}</div>
      ) : (
        <ul style={s.focusList}>
          {reviewFocus.map((item, i) => {
            const canOpen =
              onOpenFile != null && (navigablePaths == null || navigablePaths.has(item.path));
            return (
              <li key={i}>
                {canOpen ? (
                  <button
                    type="button"
                    style={{ ...s.focusRowBase, ...s.focusRowInteractive }}
                    onClick={() => onOpenFile(item.path)}
                  >
                    <Icon.FileText size={14} style={s.focusIcon} />
                    <span className="mono" style={s.focusPath}>
                      {item.path}
                    </span>
                    <span style={s.focusReason}>{item.reason}</span>
                    <Icon.ArrowRight size={14} style={s.focusArrow} />
                  </button>
                ) : (
                  <div style={{ ...s.focusRowBase, ...s.focusRowStatic }}>
                    <Icon.FileText size={14} style={s.focusIcon} />
                    <span className="mono" style={s.focusPath}>
                      {item.path}
                    </span>
                    <span style={s.focusReason}>{item.reason}</span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
