"use client";

import React from "react";
import { IntentCard } from "./_components/IntentCard";
import { BlastTab } from "./_components/BlastTab";
import { PrBriefCard } from "../PrBriefCard";
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
}

/**
 * The Overview is the mockup's three-card layout: Intent, Blast Radius, and
 * the Why + Risk Brief (SPEC-04), stacked when the viewport can't fit them
 * side by side. The old Description block is gone — the PR body already
 * lives on GitHub and in the diff context; the overview's job is the derived
 * signal, not the raw prose.
 */
export function OverviewTab({ prId, headSha, repoFullName, onOpenFile }: OverviewTabProps) {
  return (
    <div style={s.grid}>
      <IntentCard prId={prId} headSha={headSha} />
      <BlastTab prId={prId} repoFullName={repoFullName} headSha={headSha} />
      <PrBriefCard prId={prId} onOpenFile={onOpenFile} />
    </div>
  );
}
