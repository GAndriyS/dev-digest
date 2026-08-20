"use client";

import React from "react";
import { IntentCard } from "./_components/IntentCard";
import { BlastTab } from "./_components/BlastTab";
import { PrBriefCard } from "../PrBriefCard";
import { usePrBriefSection } from "@/lib/hooks/brief";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string | null;
  headSha: string;
  repoFullName: string | null;
  /**
   * Opens the Diff tab with the given repo-relative path expanded and
   * scrolled into view — forwarded to `PrBriefCard`'s Review Focus rows
   * (SPEC-04 AC-34). The query-param navigation this ultimately drives lives
   * in `page.tsx`, one layer up, so this stays optional: absent it, the
   * card's Review Focus rows render as non-interactive text instead of
   * controls with nowhere to go.
   */
  onOpenFile?: (path: string) => void;
  /**
   * The PR's current changed-file paths — forwarded to `PrBriefCard` so a
   * Review Focus row naming a path outside the Diff tab's file list renders
   * as static text rather than a dead-end button (SPEC-04 AC-36). Computed
   * in `page.tsx` from `pr.files`, which this tab doesn't otherwise fetch.
   */
  navigablePaths?: ReadonlySet<string>;
}

/**
 * The Overview is the mockup's three-card layout: Intent, Blast Radius, and
 * the Why + Risk Brief (SPEC-04), stacked when the viewport can't fit them
 * side by side. The old Description block is gone — the PR body already
 * lives on GitHub and in the diff context; the overview's job is the derived
 * signal, not the raw prose.
 */
export function OverviewTab({ prId, headSha, repoFullName, onOpenFile, navigablePaths }: OverviewTabProps) {
  // Single call site for the brief + score view model (SPEC-04 AC-62,
  // follow-up 20/08/2026). Not yet wired into either region: `PrBriefCard`
  // still reads its own `useBrief`/`useGenerateBrief`/`usePrReviews` and
  // still renders Review Focus itself until it becomes prop-driven in a
  // later step. Calling it here now proves the composition and readies the
  // call site without touching `PrBriefCard`'s props ahead of that step.
  usePrBriefSection(prId);

  return (
    <div style={s.container}>
      {/* Region 1: Why + Risk Brief, full width (SPEC-04 AC-56). */}
      <PrBriefCard prId={prId} onOpenFile={onOpenFile} navigablePaths={navigablePaths} />
      {/* Region 2: IntentCard | BlastTab, the only auto-fit grid on this tab
          (SPEC-04 AC-57, AC-58). */}
      <div style={s.pairGrid}>
        <IntentCard prId={prId} headSha={headSha} />
        <BlastTab prId={prId} repoFullName={repoFullName} headSha={headSha} />
      </div>
      {/* Region 3 (Review Focus) lands here in a later step (SPEC-04
          follow-up) — PrBriefCard still renders its own Review Focus block
          internally until then. */}
    </div>
  );
}
