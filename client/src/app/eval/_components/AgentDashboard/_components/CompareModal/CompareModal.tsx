/* CompareModal — deltas of the three metrics + cost between two selected
   batches, plus a diff of the agent's system prompt between the two batches'
   `agent_version` (AC-33). Metrics never need a fetch: both batches are
   already full `EvalBatchRecord`s from the table. The prompt diff DOES need
   one, since a batch only carries the version NUMBER, not its config
   snapshot — `GET /agents/:id/versions/:version` (existing route,
   `server/src/modules/agents/routes.ts:134-143`). A missing snapshot (404,
   AC-34 — the version was pruned/never mirrored) degrades to metric deltas
   only, with an explanation, never an empty block. */
"use client";

import { useTranslations } from "next-intl";
import { Modal, Skeleton, Button } from "@devdigest/ui";
import type { EvalBatchRecord } from "@devdigest/shared";
import { useAgentVersionSnapshot } from "@/lib/hooks/eval";
import { NO_VALUE } from "./constants";
import { diffLines, formatCostDelta, formatDeltaPt } from "./helpers";
import { s } from "./styles";

function byRanAtAscending(a: EvalBatchRecord, b: EvalBatchRecord): number {
  return new Date(a.ran_at).getTime() - new Date(b.ran_at).getTime();
}

export function CompareModal({
  agentId,
  batches,
  onClose,
}: {
  agentId: string;
  batches: [EvalBatchRecord, EvalBatchRecord];
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  // Deltas always read "later minus earlier", regardless of selection/click
  // order — the same convention the server uses for `EvalDashboard.delta`.
  // Sorting a fixed 2-tuple always yields a 2-tuple back; the array-sort
  // signature just doesn't say so.
  const [earlier, later] = [...batches].sort(byRanAtAscending) as [EvalBatchRecord, EvalBatchRecord];

  const earlierVersion = useAgentVersionSnapshot(agentId, earlier.agent_version);
  const laterVersion = useAgentVersionSnapshot(agentId, later.agent_version);

  const promptLoading = earlierVersion.isLoading || laterVersion.isLoading;
  // Any failure (404 — the common one, AC-34 — or otherwise) degrades to the
  // explanation text; metric deltas above are unaffected either way.
  const promptUnavailable = earlierVersion.isError || laterVersion.isError;

  const rows =
    !promptLoading && !promptUnavailable && earlierVersion.data && laterVersion.data
      ? diffLines(earlierVersion.data.config.system_prompt, laterVersion.data.config.system_prompt)
      : [];

  const citationDelta =
    earlier.citation_accuracy == null || later.citation_accuracy == null
      ? NO_VALUE
      : t("dashboard.delta", { value: formatDeltaPt(later.citation_accuracy - earlier.citation_accuracy) });

  return (
    <Modal
      width={760}
      title={t("compare.title")}
      subtitle={t("compare.subtitle")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="secondary" onClick={onClose}>
            {t("compare.close")}
          </Button>
        </div>
      }
    >
      <div style={s.section}>
        <h3 style={s.h3}>{t("compare.metricsHeading")}</h3>
        <div style={s.metricGrid}>
          <div style={s.metricRow}>
            <span>{t("dashboard.metrics.recall")}</span>
            <span className="tnum">{t("dashboard.delta", { value: formatDeltaPt(later.recall - earlier.recall) })}</span>
          </div>
          <div style={s.metricRow}>
            <span>{t("dashboard.metrics.precision")}</span>
            <span className="tnum">
              {t("dashboard.delta", { value: formatDeltaPt(later.precision - earlier.precision) })}
            </span>
          </div>
          <div style={s.metricRow}>
            <span>{t("dashboard.metrics.citationAccuracy")}</span>
            <span className="tnum">{citationDelta}</span>
          </div>
          <div style={s.metricRowLast}>
            <span>{t("compare.costLabel")}</span>
            <span className="tnum">{formatCostDelta(earlier.cost_usd, later.cost_usd)}</span>
          </div>
        </div>
      </div>

      <div style={s.section}>
        <h3 style={s.h3}>{t("compare.promptDiffHeading")}</h3>
        {promptLoading ? (
          <Skeleton height={120} />
        ) : promptUnavailable ? (
          <p style={s.muted}>{t("compare.promptDiffUnavailable")}</p>
        ) : (
          <div className="mono" style={s.diff}>
            {rows.map((row, i) => (
              <div key={i} style={s.diffRow(row.kind)}>
                <span style={s.sign(row.kind)}>{row.kind === "add" ? "+" : row.kind === "del" ? "−" : " "}</span>
                {/* Text node only — a system prompt is untrusted, free-form
                    text; never dangerouslySetInnerHTML, never Markdown. */}
                <span>{row.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
