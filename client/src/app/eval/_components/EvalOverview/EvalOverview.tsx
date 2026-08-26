/* EvalOverview — the `/eval` Eval Dashboard landing page (plan step 13, AC-26,
   AC-27, AC-29). Two independent sections:

   1. Agent cards — every agent with a non-empty eval-case set (the API has
      already filtered `owner_kind='agent'` and "non-empty set" server-side,
      plan step 9 — this component never re-filters `data.agents`). A card
      with `last_batch: null` shows the "never run" state, never a zero
      metric (AC-8/AC-29): reading `last_batch` directly, not some 0-filled
      placeholder, is what makes that safe here.
   2. Recent batches table — every agent's runs, one row per BATCH (not per
      case), already newest-first (`EvalDashboardOverview.recent_batches`,
      plan step 9's contract note).

   Empty states are independent: `agents.length === 0` (no agent has any eval
   case yet) reads `dashboard.overview.emptyAgents`; `recent_batches.length
   === 0` (agents exist, nobody has run yet) reads `dashboard.noRuns` — the
   CRITICAL seam (plan step 9/11): detect "no runs" via the batches array,
   never by reading a metrics object that might default to zeroes. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge, Card, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { ApiError } from "@/lib/api";
import { useEvalOverview } from "@/lib/hooks/eval";
import { formatBatchDate, formatCost, pct } from "./helpers";
import { s } from "./styles";

export function EvalOverview() {
  const t = useTranslations("eval");
  const { data, isLoading, isError, error, refetch } = useEvalOverview();

  const crumb = [{ label: t("page.crumbSkillsLab") }, { label: t("page.crumbEvalDashboard") }];

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

  const agents = data?.agents ?? [];
  const batches = data?.recent_batches ?? [];

  return (
    <AppShell crumb={crumb}>
      <div style={s.wrap}>
        <div>
          <h1 style={s.h1}>{t("dashboard.overview.title")}</h1>
          <p style={s.hint}>{t("dashboard.overview.subtitle")}</p>
        </div>

        <section>
          <h2 style={s.h2}>{t("dashboard.overview.agentsHeading")}</h2>
          {isLoading ? (
            <Skeleton height={140} />
          ) : agents.length === 0 ? (
            <EmptyState
              icon="FlaskConical"
              title={t("dashboard.overview.agentsHeading")}
              body={t("dashboard.overview.emptyAgents")}
            />
          ) : (
            <div style={s.grid}>
              {agents.map((agent) => {
                const batch = agent.last_batch;
                return (
                  <Link key={agent.agent_id} href={`/eval/${agent.agent_id}`} style={s.cardLink}>
                    <Card hover style={s.card}>
                      <div style={s.cardHeader}>
                        {/* Text node only — an agent name is untrusted, free-form input. */}
                        <span style={s.cardName} title={agent.name}>
                          {agent.name}
                        </span>
                        <Badge color="var(--text-secondary)" mono>
                          {agent.model}
                        </Badge>
                      </div>
                      {batch ? (
                        <>
                          <div style={s.cardMeta}>
                            {formatBatchDate(batch.ran_at)} · v{batch.agent_version}
                          </div>
                          <div style={s.cardMetrics}>
                            <span>
                              {t("dashboard.metrics.recall")} {pct(batch.recall)}
                            </span>
                            <span>
                              {t("dashboard.metrics.precision")} {pct(batch.precision)}
                            </span>
                            <span>
                              {t("dashboard.metrics.citationAccuracy")} {pct(batch.citation_accuracy)}
                            </span>
                          </div>
                          <div className="tnum" style={s.cardPass}>
                            {t("dashboard.table.pass")}: {batch.traces_passed}/{batch.traces_total}
                          </div>
                        </>
                      ) : (
                        <Badge color="var(--text-muted)" dot>
                          {t("evalsTab.neverRun")}
                        </Badge>
                      )}
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <section>
          <h2 style={s.h2}>{t("dashboard.overview.recentBatchesHeading")}</h2>
          {isLoading ? (
            <Skeleton height={160} />
          ) : batches.length === 0 ? (
            <EmptyState icon="BarChart" title={t("dashboard.overview.recentBatchesHeading")} body={t("dashboard.noRuns")} />
          ) : (
            <div style={s.tableWrap}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>{t("dashboard.overview.columnAgent")}</th>
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
                        <Link href={`/eval/${batch.agent_id}`} style={s.link}>
                          {batch.agent_name}
                        </Link>
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
                            <Badge color="var(--warn)">{t("dashboard.table.errored", { count: batch.cases_errored })}</Badge>
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
          )}
        </section>
      </div>
    </AppShell>
  );
}
