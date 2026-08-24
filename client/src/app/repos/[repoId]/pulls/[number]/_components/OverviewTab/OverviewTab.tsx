"use client";

import React from "react";
import { IntentCard } from "./_components/IntentCard";
import { BlastTab } from "./_components/BlastTab";
import { PrBriefCard } from "../PrBriefCard";
import { ReviewFocusPanel } from "../ReviewFocusPanel";
import { usePrBriefSection } from "@/lib/hooks/brief";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string | null;
  headSha: string;
  repoFullName: string | null;
  /**
   * Opens the Diff tab with the given repo-relative path expanded and
   * scrolled into view — forwarded to `ReviewFocusPanel`'s rows (SPEC-04
   * AC-34). The query-param navigation this ultimately drives lives in
   * `page.tsx`, one layer up, so this stays optional: absent it, the panel's
   * rows render as non-interactive text instead of controls with nowhere to
   * go.
   */
  onOpenFile?: (path: string) => void;
  /**
   * The PR's current changed-file paths — forwarded to `ReviewFocusPanel` so
   * a row naming a path outside the Diff tab's file list renders as static
   * text rather than a dead-end button (SPEC-04 AC-36). Computed in
   * `page.tsx` from `pr.files`, which this tab doesn't otherwise fetch.
   */
  navigablePaths?: ReadonlySet<string>;
}

/**
 * The Overview tab lays out three horizontal regions, in DOM order (SPEC-04
 * follow-up, AC-56, AC-69): region 1 is the Why + Risk Brief at full width,
 * region 2 is `IntentCard` and `BlastTab` in a two-column auto-fit grid, and
 * region 3 is Review Focus at full width. The old Description block is gone
 * — the PR body already lives on GitHub and in the diff context; the
 * overview's job is the derived signal, not the raw prose.
 */
export function OverviewTab({ prId, headSha, repoFullName, onOpenFile, navigablePaths }: OverviewTabProps) {
  // Single call site for the brief + score view model (SPEC-04 AC-62): both
  // region 1 (`PrBriefCard`) and region 3 (`ReviewFocusPanel`) read the same
  // one `usePrBriefSection` result, handed down as props — no second network
  // request, no second loading/error state.
  const section = usePrBriefSection(prId);
  // Region 3 renders only once a brief is actually loaded — not during the
  // initial load, not on a load error, not before the first generation
  // (AC-63). While a regenerate is in flight `section.brief` still holds the
  // last successful read (React Query doesn't touch query data until the
  // mutation resolves), so this gate keeps showing the previous
  // `review_focus[]` list, per AC-66.
  const showReviewFocus = !section.isLoading && !section.isError && section.brief != null;

  return (
    <div style={s.container}>
      {/* Region 1: Why + Risk Brief, full width (SPEC-04 AC-56). */}
      <PrBriefCard
        brief={section.brief}
        isLoading={section.isLoading}
        isError={section.isError}
        refetch={section.refetch}
        score={section.score}
        generate={section.generate}
      />
      {/* Region 2: IntentCard | BlastTab, the only auto-fit grid on this tab
          (SPEC-04 AC-57, AC-58). */}
      <div style={s.pairGrid}>
        <IntentCard prId={prId} headSha={headSha} />
        <BlastTab prId={prId} repoFullName={repoFullName} headSha={headSha} />
      </div>
      {/* Region 3: Review Focus, full width (SPEC-04 AC-56, AC-60, AC-63). */}
      {showReviewFocus && (
        <ReviewFocusPanel
          reviewFocus={section.brief!.review_focus}
          onOpenFile={onOpenFile}
          navigablePaths={navigablePaths}
        />
      )}
    </div>
  );
}
