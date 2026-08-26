/* AgentDashboard — the `/eval/[agentId]` per-agent Eval Dashboard page (plan
   step 13, AC-30–AC-34).

   CRITICAL seam (dashboard lane, plan step 9): `EvalDashboard.current`/
   `.delta` are NON-nullable 0-filled placeholders when no batch has ever run
   — "no runs yet" is read from `recent_batches.length === 0`, never from
   `current`/`delta` (AC-29: no zeros that read as results). Everything below
   the empty-state branch only renders once that check has passed. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, Checkbox, EmptyState, ErrorState, Icon, LineChart, Skeleton } from "@devdigest/ui";
import type { EvalAlert, EvalBatchRecord } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { ApiError } from "@/lib/api";
import { useAgent } from "@/lib/hooks/agents";
import { useAgentEvalDashboard } from "@/lib/hooks/eval";
import { CompareModal } from "./_components/CompareModal";
import {
  deltaDirection,
  formatBatchDate,
  formatCost,
  formatDeltaPt,
  otherMetricDeltaPp,
  pct,
} from "./helpers";
import { s } from "./styles";

const OTHER_METRIC_KEYS = ["recall", "precision", "citation_accuracy"] as const;

function metricLegendKey(key: (typeof OTHER_METRIC_KEYS)[number]): "recall" | "precision" | "citation" {
  return key === "citation_accuracy" ? "citation" : key;
}

function MetricTile({
  label,
  value,
  delta,
  t,
}: {
  label: string;
  value: string;
  delta: number;
  t: ReturnType<typeof useTranslations>;
}) {
  const direction = deltaDirection(delta);
  const DeltaIcon = direction === "up" ? Icon.ArrowUp : direction === "down" ? Icon.ArrowDown : Icon.Slash;
  return (
    <div style={s.metricCard}>
      <div style={s.metricLabel}>{label}</div>
      <div className="tnum" style={s.metricValue}>
        {value}
      </div>
      <div className="tnum" style={s.metricDelta(direction)}>
        <DeltaIcon size={12} aria-hidden />
        <span>{t("dashboard.delta", { value: formatDeltaPt(delta) })}</span>
      </div>
    </div>
  );
}

function RegressionBanner({
  alert,
  previous,
  t,
}: {
  alert: EvalAlert;
  previous: EvalBatchRecord | undefined;
  t: ReturnType<typeof useTranslations>;
}) {
  const metricLabel = t(`dashboard.legend.${metricLegendKey(alert.metric)}`);
  const others = OTHER_METRIC_KEYS.filter((key) => key !== alert.metric);

  return (
    <div role="alert" style={s.banner}>
      <Icon.AlertTriangle size={18} style={s.bannerIcon} aria-hidden />
      <div>
        <div style={s.bannerTitle}>{t("dashboard.alert.title")}</div>
        <div style={s.bannerBody}>
          {t("dashboard.alert.body", { metric: metricLabel, drop: alert.drop_pp.toFixed(1) })}
        </div>
        <div style={s.bannerOthers}>
          {others.map((key) => {
            const label = t(`dashboard.legend.${metricLegendKey(key)}`);
            const deltaPp = otherMetricDeltaPp(alert.others[key], previous, key);
            if (deltaPp == null || deltaPp === 0) {
              return <span key={key}>{t("dashboard.alert.otherFlat", { metric: label })}</span>;
            }
            const tone = deltaPp > 0 ? "otherUp" : "otherDown";
            return (
              <span key={key}>
                {t(`dashboard.alert.${tone}`, { metric: label, value: Math.abs(deltaPp).toFixed(1) })}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function AgentDashboard() {
  const { agentId } = useParams<{ agentId: string }>();
  const t = useTranslations("eval");

  const { data: agent } = useAgent(agentId);
  const { data, isLoading, isError, error, refetch } = useAgentEvalDashboard(agentId);

  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [comparing, setComparing] = React.useState(false);

  const crumb = [
    { label: t("page.crumbSkillsLab") },
    { label: t("page.crumbEvalDashboard"), href: "/eval" },
    { label: agent?.name ?? "" },
  ];

  if (isError) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          body={error instanceof ApiError ? error.message : undefined}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  if (isLoading || !data) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.wrap}>
          <Skeleton height={300} />
        </div>
      </AppShell>
    );
  }

  const batches = data.recent_batches; // newest first (contract note, plan step 9)
  const noRuns = batches.length === 0;

  const toggle = (batchId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
  };

  const selectedBatches = batches.filter((b) => selected.has(b.batch_id));
  // AC-32: Compare is enabled EXACTLY at two selected rows, never at 0/1/3+.
  const canCompare = selectedBatches.length === 2;

  return (
    <AppShell crumb={crumb}>
      <div style={s.wrap}>
        <h1 style={s.h1}>{agent?.name ?? t("dashboard.defaultTitle")}</h1>

        {noRuns ? (
          <EmptyState icon="BarChart" title={t("dashboard.defaultTitle")} body={t("dashboard.noRuns")} />
        ) : (
          <>
            {data.alert && <RegressionBanner alert={data.alert} previous={batches[1]} t={t} />}

            <div style={s.metricsRow}>
              <MetricTile
                label={t("dashboard.metrics.recall")}
                value={pct(data.current.recall)}
                delta={data.delta.recall}
                t={t}
              />
              <MetricTile
                label={t("dashboard.metrics.precision")}
                value={pct(data.current.precision)}
                delta={data.delta.precision}
                t={t}
              />
              <MetricTile
                label={t("dashboard.metrics.citationAccuracy")}
                value={pct(data.current.citation_accuracy)}
                delta={data.delta.citation_accuracy}
                t={t}
              />
            </div>

            {data.trend.length > 0 && (
              <div style={s.chartSection}>
                <h2 style={s.h2}>{t("dashboard.metricTrend")}</h2>
                <div style={s.legend}>
                  <span style={s.legendItem}>
                    <span style={s.legendDot("var(--accent)")} />
                    {t("dashboard.legend.recall")}
                  </span>
                  <span style={s.legendItem}>
                    <span style={s.legendDot("var(--ok)")} />
                    {t("dashboard.legend.precision")}
                  </span>
                  <span style={s.legendItem}>
                    <span style={s.legendDot("var(--warn)")} />
                    {t("dashboard.legend.citation")}
                  </span>
                </div>
                <LineChart
                  series={[
                    { name: "recall", color: "var(--accent)", data: data.trend.map((p) => p.recall) },
                    { name: "precision", color: "var(--ok)", data: data.trend.map((p) => p.precision) },
                    {
                      name: "citation",
                      color: "var(--warn)",
                      data: data.trend.map((p) => p.citation_accuracy),
                    },
                  ]}
                />
              </div>
            )}

            <div style={s.tableSection}>
              <div style={s.tableHeader}>
                <h2 style={s.tableHeading}>{t("dashboard.recentRuns")}</h2>
                <Button kind="primary" size="sm" disabled={!canCompare} onClick={() => setComparing(true)}>
                  {t("compare.button")}
                </Button>
              </div>
              {selected.size > 0 && !canCompare && <p style={s.selectHint}>{t("compare.selectHint")}</p>}
              <div style={s.tableWrap}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th} />
                      <th style={s.th}>{t("dashboard.overview.columnVersion")}</th>
                      <th style={s.th}>{t("dashboard.table.ranAt")}</th>
                      <th style={s.th}>{t("dashboard.table.recall")}</th>
                      <th style={s.th}>{t("dashboard.table.precision")}</th>
                      <th style={s.th}>{t("dashboard.table.citation")}</th>
                      <th style={s.th}>{t("dashboard.table.pass")}</th>
                      <th style={s.th}>{t("dashboard.table.cost")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map((batch) => (
                      <tr key={batch.batch_id}>
                        <td style={s.td}>
                          <Checkbox checked={selected.has(batch.batch_id)} onChange={() => toggle(batch.batch_id)} />
                        </td>
                        <td className="tnum" style={s.td}>
                          v{batch.agent_version}
                        </td>
                        <td style={s.td}>{formatBatchDate(batch.ran_at)}</td>
                        <td className="tnum" style={s.td}>
                          {pct(batch.recall)}
                        </td>
                        <td className="tnum" style={s.td}>
                          {pct(batch.precision)}
                        </td>
                        <td className="tnum" style={s.td}>
                          {pct(batch.citation_accuracy)}
                        </td>
                        <td className="tnum" style={s.td}>
                          {batch.traces_passed}/{batch.traces_total}
                          {batch.cases_errored > 0 && (
                            <span title={t("dashboard.table.erroredNote")} style={s.erroredBadge}>
                              <Badge color="var(--warn)">
                                {t("dashboard.table.errored", { count: batch.cases_errored })}
                              </Badge>
                            </span>
                          )}
                        </td>
                        <td className="tnum" style={s.td}>
                          {formatCost(batch.cost_usd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {comparing && canCompare && (
              <CompareModal
                agentId={agentId}
                batches={[selectedBatches[0]!, selectedBatches[1]!]}
                onClose={() => setComparing(false)}
              />
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
