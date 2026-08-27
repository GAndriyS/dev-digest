/* EvalsTab (L06, SPEC-05) — regression tests for an agent's review behaviour:
   a diff in, expected findings (file + overlapping line range) out. Scoring
   is file:line based (server modules/eval/scoring.ts), a different
   comparator than the skill Evals tab's severity-multiset one — the two
   scorers coexist on purpose (plan Non-goals), so this tab is a deliberate
   structural COPY of the skill EvalsTab, not a shared ancestor (plan step 11,
   Recommendations R4).

   Run state here is two mutations, not one: the header's `useRunAgentEvalBatch`
   runs the agent's whole eval set as a batch (`POST /agents/:id/eval-runs`),
   sequentially server-side (AC-12); a single case can also be run, but from
   inside its own editor (`EvalCaseModal`'s `Run case` button, wave 3's
   `POST /agents/:id/eval-cases/:caseId/run`), not from the row — each row
   still carries only edit/delete, never its own Run button.

   Last-run status per case comes from the dashboard read
   (`useAgentEvalDashboard`, AC-9), never from the run mutation's own result:
   a case's last run may predate this page load, and `EvalDashboard.
   recent_runs` is the read that knows about every run, not just one just
   triggered here.

   CRITICAL seam (dashboard lane, plan step 9): `EvalDashboard.current` is a
   NON-nullable 0-filled placeholder when no batch has ever run (`.delta` is
   nullable — fix pass, item 5 — but this tab never reads it either) — "no
   runs yet" is read from `recent_batches.length === 0`, never from `current`
   (AC-29: no zeros that read as results). This tab never reads
   `dashboard.current` at all; it reads `recent_batches[0]` directly, which
   only exists once a batch actually ran. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, IconBtn, MetricCard, Skeleton } from "@devdigest/ui";
import type { EvalCase } from "@devdigest/shared";
import {
  isNoProviderKeyError,
  useAgentEvalCases,
  useAgentEvalDashboard,
  useDeleteAgentEvalCase,
  useRunAgentEvalBatch,
} from "@/lib/hooks/eval";
import { EvalCaseModal } from "./_components/EvalCaseModal";
import { KIND_COLORS, NO_VALUE, OUTCOME_COLORS } from "./constants";
import {
  caseOutcome,
  countPassed,
  expectationKindOf,
  expectationMismatch,
  expectedFindings,
  latestRunByCase,
} from "./helpers";
import { s } from "./styles";

function pct(value: number | null): string {
  return value == null ? NO_VALUE : `${Math.round(value * 100)}%`;
}

export function EvalsTab({ agentId }: { agentId: string }) {
  const t = useTranslations("eval");

  const { data: cases, isLoading, isError, refetch } = useAgentEvalCases(agentId);
  const dashboard = useAgentEvalDashboard(agentId);
  const del = useDeleteAgentEvalCase();
  const run = useRunAgentEvalBatch();

  /** undefined = modal closed, null = creating, EvalCase = editing. */
  const [editing, setEditing] = React.useState<EvalCase | null | undefined>(undefined);

  const list = cases ?? [];
  const recentRuns = dashboard.data?.recent_runs ?? [];
  const recentBatches = dashboard.data?.recent_batches ?? [];
  const latest = latestRunByCase(recentRuns);
  const passed = countPassed(list, latest);
  // recent_batches[0] is the latest batch, or undefined when none ran yet —
  // see the CRITICAL seam note above.
  const latestBatch = recentBatches[0];

  const noProviderKey = isNoProviderKeyError(run.error);
  const running = run.isPending;

  const onDelete = (c: EvalCase) => {
    if (!window.confirm(t("evalsTab.deleteConfirm", { name: c.name }))) return;
    del.mutate({ agentId, id: c.id });
  };

  const onRun = () => {
    if (running) return; // NFR: a second click while a run is in flight is a no-op
    run.mutate(agentId);
  };

  if (isError) return <ErrorState body={t("evalsTab.loadError")} onRetry={() => refetch()} />;
  if (isLoading) return <Skeleton height={200} />;

  return (
    <div style={s.wrap}>
      {editing !== undefined && (
        <EvalCaseModal
          agentId={agentId}
          evalCase={editing}
          lastRun={editing ? latest.get(editing.id) : undefined}
          onClose={() => setEditing(undefined)}
        />
      )}

      <div style={s.header}>
        <h2 style={s.h2}>{t("evalsTab.casesHeading")}</h2>
        {list.length > 0 && (
          <Badge color={passed === list.length ? "var(--ok)" : "var(--text-secondary)"}>
            {t("evalsTab.tracesSummary", { passed, total: list.length })}
          </Badge>
        )}
        <div style={s.actions}>
          <Button
            kind="secondary"
            size="sm"
            icon="Play"
            onClick={onRun}
            disabled={noProviderKey || running || list.length === 0}
            title={noProviderKey ? t("evalsTab.noProviderKey") : undefined}
          >
            {running ? t("evalsTab.running") : t("evalsTab.run")}
          </Button>
          <Button kind="primary" size="sm" icon="Plus" onClick={() => setEditing(null)}>
            {t("evalsTab.newCase")}
          </Button>
        </div>
      </div>

      {noProviderKey && (
        <div role="alert" style={s.notice}>
          {t("evalsTab.noProviderKey")}
        </div>
      )}

      {list.length === 0 ? (
        <EmptyState
          icon="FlaskConical"
          title={t("evalsTab.casesHeading")}
          body={t("evalsTab.emptyCases")}
          cta={t("evalsTab.newCase")}
          onCta={() => setEditing(null)}
        />
      ) : (
        <div style={s.list}>
          {list.map((c) => {
            const lastRun = latest.get(c.id);
            const outcome = caseOutcome(lastRun);
            // AC-7: read from the stored field, never re-derived from
            // `expected_output` — `expectationKindOf` falls back to that
            // derivation only for a pre-migration row with no stored kind.
            const kind = expectationKindOf(c);
            const count = expectedFindings(c.expected_output).length;
            const mismatch = expectationMismatch(c);
            return (
              <div key={c.id} style={s.row}>
                <Badge color={OUTCOME_COLORS[outcome]} dot>
                  {outcome === "never" ? t("evalsTab.neverRun") : t(`evalsTab.${outcome}`)}
                </Badge>
                {/* Text node only — never dangerouslySetInnerHTML, never
                    Markdown: a case name can carry markup or be very long. */}
                <span style={s.name} title={c.name}>
                  {c.name}
                </span>
                {/* The vendored Badge takes no `title`, so the tooltip lives on
                    a wrapper — same shape EvalOverview uses for its errored
                    badge. The icon alone never said what the number counts. */}
                <span
                  style={s.expectedCountWrap}
                  title={t(
                    `evalsTab.expectedCount.${kind === "must_find" ? "mustFind" : "mustNotFlag"}`,
                    { count },
                  )}
                >
                  <Badge color="var(--text-muted)" icon={kind === "must_find" ? "Target" : "Slash"} mono>
                    {count}
                  </Badge>
                </span>
                {/* AC-7: the kind in words — colour is additive on top of the
                    words, never the sole carrier (AC-62). */}
                <span className="mono" style={{ ...s.kindLabel, color: KIND_COLORS[kind] }}>
                  {t(`evalsTab.kind.${kind === "must_find" ? "mustFind" : "mustNotFlag"}`)}
                </span>
                {mismatch && (
                  <span style={s.mismatch}>
                    {t("evalsTab.kindMismatch", { kind: mismatch.kind, count: mismatch.count })}
                  </span>
                )}
                {outcome === "errored" && lastRun?.error ? (
                  <span style={s.meta}>{t("evalsTab.erroredReason", { reason: lastRun.error.message })}</span>
                ) : lastRun?.recall != null ? (
                  <span className="tnum" style={s.meta}>
                    {t("evalsTab.recallSuffix", { recall: Math.round(lastRun.recall * 100) })}
                  </span>
                ) : null}
                <div style={s.rowActions}>
                  <IconBtn icon="Edit" label={t("evalsTab.edit")} onClick={() => setEditing(c)} />
                  <IconBtn icon="Trash" label={t("evalsTab.delete")} onClick={() => onDelete(c)} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {latestBatch && (
        <div style={s.metrics}>
          <h3 style={s.h3}>{t("evalsTab.metricsTitle")}</h3>
          <p style={s.hint}>{t("evalsTab.metricsSubtitle")}</p>
          <div style={s.metricsRow}>
            <MetricCard label={t("dashboard.metrics.recall")} value={pct(latestBatch.recall)} />
            <MetricCard label={t("dashboard.metrics.precision")} value={pct(latestBatch.precision)} />
            <MetricCard label={t("dashboard.metrics.citationAccuracy")} value={pct(latestBatch.citation_accuracy)} />
          </div>
          <p style={s.hint}>
            {t("evalsTab.tracesSummary", { passed: latestBatch.traces_passed, total: latestBatch.traces_total })}
          </p>
          <Link href={`/eval/${agentId}`} style={s.link}>
            {t("evalsTab.viewDashboard")}
          </Link>
        </div>
      )}
    </div>
  );
}
