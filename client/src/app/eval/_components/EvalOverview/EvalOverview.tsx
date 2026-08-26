/* EvalOverview — the `/eval` Eval Dashboard landing page (AC-26, AC-27, AC-29,
   AC-36…AC-52). Three parts:

   1. Header row — title, the AC-36 subtitle and, right-aligned, the accent
      `Run all agents` button. The button only OPENS the confirmation dialog
      (AC-46) — `useRunAllAgentEvalBatches().run()` is called from the
      dialog's `onConfirm`, never from the button itself, so no model call
      happens before a human confirms both counts. Disabled while a run is in
      progress (AC-49), disabled with a TEXTUAL reason when no agent has any
      eval case (AC-50, `agents.length === 0` — the server already filters to
      non-empty sets, so this component never re-filters `data.agents`), and
      sticky-disabled with the AC-24 `dashboard.noProviderKey` copy once every
      attempted agent has failed 409 `no_provider_key` (AC-52). Below the
      header, a compact per-agent failure list (AC-51) — hidden as soon as
      `isRunning` flips true, which is this component's way of honouring the
      plan's "cleared when the next run starts" default: the hook itself only
      overwrites `outcomes` once the whole run settles, not at the start.

   2. AGENTS section — one full-width `AgentRow` per agent (AC-26) instead of
      the previous card grid; `AgentRow` owns the never-run branch, the
      sparkline gate and the three stat blocks internally (see its own file
      header for the two seams it asserts).

   3. RECENT EVAL RUNS · ALL AGENTS table — one row per BATCH, already
      newest-first from the API. Columns are agent → time → version → recall
      → precision → citation → pass → cost (AC-27, AC-43…AC-45): the agent
      name is plain escaped text, the version cell is the ONLY link (to
      `/eval/:agentId`), each metric renders as a bar + a number that is
      always printed (never the bar alone), the pass cell is bold, and the
      `errored` badge — a KEPT behaviour, not new — still rides inside it.

   Empty states are independent and unchanged: `agents.length === 0` reads
   `dashboard.overview.emptyAgents`; `recent_batches.length === 0` reads
   `dashboard.noRuns` — detected via the batches array, never by reading a
   metrics object that might default to zeroes. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, ProgressBar, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { ApiError } from "@/lib/api";
import { useEvalOverview, useRunAllAgentEvalBatches } from "@/lib/hooks/eval";
import { AgentRow } from "./_components/AgentRow";
import { RunAllDialog } from "./_components/RunAllDialog";
import { formatBatchDate, formatCost, pct } from "./helpers";
import { METRIC_COLOR } from "./constants";
import { s } from "./styles";

/** One recall/precision/citation table cell (AC-44): a horizontal bar plus
    the always-printed percentage. `null` renders the em dash and no bar —
    the bar and its colour are never the sole carrier of the value. Module-
    level, not nested in `EvalOverview`, so it keeps a stable component
    identity across the parent's renders. */
function MetricCell({ value, color }: { value: number | null; color: string }) {
  if (value == null) {
    return <span className="tnum">{pct(value)}</span>;
  }
  return (
    <div style={s.metricCell}>
      <div style={s.metricBar}>
        <ProgressBar value={value * 100} color={color} />
      </div>
      <span className="tnum" style={s.metricValue}>
        {pct(value)}
      </span>
    </div>
  );
}

export function EvalOverview() {
  const t = useTranslations("eval");
  const { data, isLoading, isError, error, refetch } = useEvalOverview();
  const { run, isRunning, outcomes, allNoProviderKey } = useRunAllAgentEvalBatches();
  const [dialogOpen, setDialogOpen] = React.useState(false);

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
  const casesTotal = agents.reduce((total, agent) => total + agent.cases_total, 0);
  const noAgents = agents.length === 0;
  const runDisabled = isRunning || noAgents || allNoProviderKey;
  // Visually "cleared when the next run starts" (plan Open questions
  // default) — the hook only overwrites `outcomes` once the whole run
  // settles, so this component hides the previous run's failures itself the
  // moment a new one begins.
  const failures = isRunning ? [] : outcomes.filter((outcome) => outcome.status === "error");

  const handleConfirm = () => {
    setDialogOpen(false);
    void run(agents.map((agent) => ({ agent_id: agent.agent_id, name: agent.name })));
  };

  return (
    <AppShell crumb={crumb}>
      <div style={s.wrap}>
        <div style={s.headerRow}>
          <div>
            <h1 style={s.h1}>{t("dashboard.overview.title")}</h1>
            <p style={s.hint}>{t("dashboard.overview.subtitle")}</p>
          </div>
          <div style={s.headerActions}>
            <Button
              kind="primary"
              icon="Play"
              loading={isRunning}
              disabled={runDisabled}
              onClick={() => setDialogOpen(true)}
            >
              {t("runAllAgents.button")}
            </Button>
            {!isRunning && noAgents && <p style={s.disabledReason}>{t("runAllAgents.disabledReason")}</p>}
            {!isRunning && !noAgents && allNoProviderKey && (
              <p style={s.disabledReason}>{t("dashboard.noProviderKey")}</p>
            )}
          </div>
        </div>

        {failures.length > 0 && (
          <ul style={s.failureList}>
            {failures.map((outcome) => (
              <li key={outcome.agent_id} style={s.failureItem}>
                {t("runAllAgents.failure", { name: outcome.name, reason: outcome.message })}
              </li>
            ))}
          </ul>
        )}

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
            <div style={s.rows}>
              {agents.map((agent) => (
                <AgentRow key={agent.agent_id} agent={agent} />
              ))}
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
                    <th style={s.th}>{t("dashboard.table.ranAt")}</th>
                    <th style={s.th}>{t("dashboard.overview.columnVersion")}</th>
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
                        {/* Text node only — agent name is untrusted, free-form
                            input; plain text, never a link (AC-43). */}
                        {batch.agent_name}
                      </td>
                      <td style={s.td}>{formatBatchDate(batch.ran_at)}</td>
                      <td className="tnum" style={s.td}>
                        <Link href={`/eval/${batch.agent_id}`} style={s.link}>
                          v{batch.agent_version}
                        </Link>
                      </td>
                      <td style={s.td}>
                        <MetricCell value={batch.recall} color={METRIC_COLOR.recall} />
                      </td>
                      <td style={s.td}>
                        <MetricCell value={batch.precision} color={METRIC_COLOR.precision} />
                      </td>
                      <td style={s.td}>
                        <MetricCell value={batch.citation_accuracy} color={METRIC_COLOR.citation} />
                      </td>
                      <td className="tnum" style={s.tdBold}>
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

      {dialogOpen && (
        <RunAllDialog
          agentsCount={agents.length}
          casesTotal={casesTotal}
          onConfirm={handleConfirm}
          onCancel={() => setDialogOpen(false)}
        />
      )}
    </AppShell>
  );
}
