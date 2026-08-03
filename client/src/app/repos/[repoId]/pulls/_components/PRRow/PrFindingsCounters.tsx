/* Counters for a PR-list row, with the findings hover card wired to a lazy fetch.

   The list endpoint returns per-severity COUNTS only — deliberately, since it
   polls every 60s and every finding carries full markdown. So the hover card's
   contents are fetched per PR on first hover, from the same `["reviews", prId]`
   cache entry the detail page uses: hovering a row warms the page it links to. */
"use client";

import React from "react";
import { SeverityCounters, type SeverityCountsView } from "@/components/severity-counters";
import { usePrReviews } from "@/lib/hooks/reviews";
import type { Severity } from "@devdigest/shared";

export function PrFindingsCounters({
  prId,
  counts,
  onSelect,
}: {
  prId: string | null | undefined;
  counts: SeverityCountsView;
  onSelect?: (severity: Severity) => void;
}) {
  const [wanted, setWanted] = React.useState(false);
  const { data, isPending } = usePrReviews(prId, { enabled: wanted });

  const findings = React.useMemo(
    () => (data ? data.flatMap((review) => review.findings) : undefined),
    [data],
  );

  return (
    <SeverityCounters
      counts={counts}
      onSelect={onSelect}
      findings={findings}
      findingsLoading={wanted && isPending}
      onFindingsHoverStart={() => setWanted(true)}
    />
  );
}
