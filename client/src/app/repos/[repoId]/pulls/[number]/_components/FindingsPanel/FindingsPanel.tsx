/* FindingsPanel — hide-low-confidence + j/k navigation + FindingCard list,
   wiring the accept/dismiss action hook (A2). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Toggle, EmptyState } from "@devdigest/ui";
import type { FindingRecord, Severity } from "@devdigest/shared";
import { FindingCard } from "../FindingCard";
import { useFindingAction } from "../../../../../../../lib/hooks/reviews";
import { KEY_TO_ACTION, SCROLL_SETTLE_MAX_FRAMES } from "./constants";
import { visibleFindings } from "./helpers";
import { s } from "./styles";

export function FindingsPanel({
  findings,
  prId,
  repoFullName,
  headSha,
  severityFilter = null,
  targetFindingId = null,
}: {
  findings: FindingRecord[];
  prId: string;
  repoFullName?: string | null;
  headSha?: string | null;
  /** Page-level severity filter (?severity=) — null shows every severity. */
  severityFilter?: Severity | null;
  /** Finding navigated to from the Diff tab (?finding=) — bypasses filters,
   *  starts focused + expanded, and gets scrolled into view. */
  targetFindingId?: string | null;
}) {
  const t = useTranslations("prReview");
  const action = useFindingAction();
  const [hideLow, setHideLow] = React.useState(false);
  // Lazy initializer: land directly on the target's index instead of
  // flashing focus at 0 before a later effect corrects it.
  const [focusIdx, setFocusIdx] = React.useState(() => {
    if (!targetFindingId) return 0;
    const initial = visibleFindings(findings, false, severityFilter, targetFindingId);
    const idx = initial.findIndex((f) => f.id === targetFindingId);
    return idx >= 0 ? idx : 0;
  });

  const shown = React.useMemo(
    () => visibleFindings(findings, hideLow, severityFilter, targetFindingId),
    [findings, hideLow, severityFilter, targetFindingId],
  );

  // Navigated in from the Diff tab — scroll the target card into view. The
  // anchor (`data-finding-id`) already exists on FindingCard; this is its
  // first reader.
  //
  // Scrolling once on mount lands short: the accordions above this panel open
  // in their own effects and their cards expand as they render, so the target
  // keeps sliding down the document for several frames after this effect runs
  // (measured: a single scroll stopped 2252px above the card). So re-scroll
  // every frame until the card's DOCUMENT offset — which our own scrolling
  // does not change, unlike its viewport rect — holds still, then stop. The
  // frame cap keeps a genuinely never-settling layout from looping forever,
  // and `behavior` stays instant: a smooth animation would chase a target
  // that moves out from under it.
  React.useEffect(() => {
    if (!targetFindingId) return;
    const selector = `[data-finding-id="${CSS.escape(targetFindingId)}"]`;
    const documentTop = (el: HTMLElement) => {
      let y = 0;
      for (let n: HTMLElement | null = el; n; n = n.offsetParent as HTMLElement | null) y += n.offsetTop;
      return y;
    };
    let raf = 0;
    let lastTop = Number.NaN;
    let stableFrames = 0;
    let frames = 0;
    const tick = () => {
      const el = document.querySelector<HTMLElement>(selector);
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
  }, [targetFindingId]);

  // j/k navigation + a/d shortcuts on the focused finding (keyboard).
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "j") setFocusIdx((i) => Math.min(i + 1, shown.length - 1));
      else if (e.key === "k") setFocusIdx((i) => Math.max(i - 1, 0));
      else if (KEY_TO_ACTION[e.key] && shown[focusIdx]) {
        action.mutate({ findingId: shown[focusIdx]!.id, action: KEY_TO_ACTION[e.key]!, prId });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shown, focusIdx, action, prId]);

  return (
    <div>
      <div style={s.toolbar}>
        <div style={s.toggleGroup}>
          {t("panel.hideLowConfidence")}
          <Toggle on={hideLow} onChange={setHideLow} size={16} />
        </div>
      </div>

      <div style={s.list}>
        {shown.length === 0 ? (
          <EmptyState icon="Filter" title={t("panel.noMatchTitle")} body={t("panel.noMatchBody")} />
        ) : (
          shown.map((f, i) => (
            <FindingCard
              key={f.id}
              f={f}
              focused={i === focusIdx}
              defaultExpanded={i === focusIdx}
              pending={action.isPending}
              repoFullName={repoFullName}
              headSha={headSha}
              onAction={(act) => action.mutate({ findingId: f.id, action: act, prId })}
            />
          ))
        )}
      </div>
    </div>
  );
}
