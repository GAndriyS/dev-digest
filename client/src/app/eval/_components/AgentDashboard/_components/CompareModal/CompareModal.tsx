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
import { Modal, Skeleton, Button, Badge, Icon } from "@devdigest/ui";
import type { EvalBatchRecord } from "@devdigest/shared";
import { useAgentVersionSnapshot } from "@/lib/hooks/eval";
import { COMPARE_METRICS, DELTA_TONE, DIFF_COLORS } from "./constants";
import { diffLines, deltaBadge } from "./helpers";
import { formatCost, pct } from "../../helpers";
import { s } from "./styles";

/** The three scored metrics live directly on the batch; cost is read
    separately because its field is named differently. */
type MetricKey = "recall" | "precision" | "citation_accuracy";

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

  // AC-32 lets a user tick two runs of the SAME version. There is then no
  // prompt to diff, so this branch is evaluated BEFORE loading and error:
  // neither an in-flight fetch nor a 404 should preempt the plain truth that
  // the prompt did not change.
  const sameVersion = earlier.agent_version === later.agent_version;

  return (
    <Modal
      width={760}
      title={
        sameVersion
          ? t("compare.titleSameVersion", { version: later.agent_version })
          : t("compare.titleVersions", { older: earlier.agent_version, newer: later.agent_version })
      }
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
        <div style={s.headingRow}>
          <span style={s.microHeading}>{t("compare.metricsHeading")}</span>
        </div>
        <div style={s.cardGrid}>
          {COMPARE_METRICS.map((metric) => {
            const isCost = metric.unit === "usd";
            const before = isCost ? earlier.cost_usd : earlier[metric.key as MetricKey];
            const after = isCost ? later.cost_usd : later[metric.key as MetricKey];
            const badge = deltaBadge(before, after, metric.higherIsBetter, metric.unit);
            const show = (v: number | null) => (isCost ? formatCost(v) : pct(v));

            return (
              <div key={metric.key} style={s.card}>
                <span style={s.cardLabel}>{t(`compare.${metric.labelKey}`)}</span>
                <div style={s.cardValues}>
                  <span className="tnum" style={s.cardBefore}>
                    {show(before)}
                  </span>
                  <span style={s.cardArrow} aria-hidden>
                    →
                  </span>
                  <span className="tnum" style={s.cardAfter(metric.color)}>
                    {show(after)}
                  </span>
                </div>
                {/* No badge at all when a side is null: "not measured" is not
                    "unchanged", and a 0.0 there would read as a real result. */}
                {badge && (
                  <Badge color={DELTA_TONE[badge.tone].fg} bg={DELTA_TONE[badge.tone].bg} mono>
                    {badge.arrow ? `${badge.arrow} ` : ""}
                    {metric.unit === "pt" ? t("dashboard.delta", { value: badge.text }) : badge.text}
                  </Badge>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div style={s.section}>
        <div style={s.headingRow}>
          <Icon.FileText size={13} aria-hidden />
          <span style={s.microHeading}>{t("compare.promptDiffHeading")}</span>
        </div>
        {sameVersion ? (
          <p style={s.muted}>{t("compare.promptDiffSameVersion", { version: later.agent_version })}</p>
        ) : promptLoading ? (
          <Skeleton height={120} />
        ) : promptUnavailable ? (
          <p style={s.muted}>{t("compare.promptDiffUnavailable")}</p>
        ) : (
          <>
            {/* Names which colour means which version — the diff below is two
                prompts, not one file's history, so "old"/"new" alone is thin. */}
            <div style={s.legend}>
              <span style={s.legendItem}>
                <span style={s.legendSwatch(DIFF_COLORS.del.fg)} aria-hidden />
                {t("compare.legendOld", { version: earlier.agent_version })}
              </span>
              <span style={s.legendItem}>
                <span style={s.legendSwatch(DIFF_COLORS.add.fg)} aria-hidden />
                {t("compare.legendNew", { version: later.agent_version })}
              </span>
            </div>
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
          </>
        )}
      </div>
    </Modal>
  );
}
