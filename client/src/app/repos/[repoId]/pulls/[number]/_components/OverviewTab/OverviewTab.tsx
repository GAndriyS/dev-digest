"use client";

import React from "react";
import { IntentCard } from "./_components/IntentCard";
import { BlastTab } from "./_components/BlastTab";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string | null;
  headSha: string;
  repoFullName: string | null;
}

/**
 * The Overview is the mockup's two-card layout: Intent on the left, Blast
 * Radius on the right (stacked when the viewport can't fit both). The old
 * Description block is gone — the PR body already lives on GitHub and in the
 * diff context; the overview's job is the derived signal, not the raw prose.
 */
export function OverviewTab({ prId, headSha, repoFullName }: OverviewTabProps) {
  return (
    <div style={s.grid}>
      <IntentCard prId={prId} headSha={headSha} />
      <BlastTab prId={prId} repoFullName={repoFullName} headSha={headSha} />
    </div>
  );
}
