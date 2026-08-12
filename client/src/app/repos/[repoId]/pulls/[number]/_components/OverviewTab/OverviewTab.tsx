"use client";

import React from "react";
import { Markdown, SectionLabel } from "@devdigest/ui";
import { IntentCard } from "./_components/IntentCard";
import { s } from "./styles";

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string | null;
  headSha: string;
}

export function OverviewTab({ prBody, prId, headSha }: OverviewTabProps) {
  return (
    <>
      <IntentCard prId={prId} headSha={headSha} />

      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          {/* A PR body is Markdown, and this repo's own convention puts an
              `## Insights` section at the end of every one — rendered raw, that
              heading and the surrounding lists read as literal `##` and `-`.
              `Markdown` escapes embedded HTML (no rehype-raw), which matters
              because a PR body is attacker-controlled input. */}
          <div style={s.descriptionBox}>
            <Markdown>{prBody}</Markdown>
          </div>
        </section>
      )}
    </>
  );
}
