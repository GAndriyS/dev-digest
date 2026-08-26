/* AgentRow — one full-width row per agent on the `/eval` overview (AC-26,
   AC-37…AC-42). Replaces the previous card-grid tile: a square icon tile, the
   agent's bold name + mono model badge, a `Last run v<N> · <ts> · X/Y pass`
   meta line, a `recall` sparkline and three always-numeric RECALL/PREC/CITE
   stat blocks, in that order (mock layout). The sparkline is decorative
   (`aria-hidden`) — the stat blocks already print the numbers (AC-39), so it
   never carries meaning the row's single accessible name would otherwise
   lose.

   Two CRITICAL seams, both asserted in AgentRow.test.tsx, not just inspected:

   1. Exactly ONE focusable target per row (AC-37, NFR Доступність). The whole
      row is a single `next/link` `<Link>` — that gives free Enter-activation
      and a native focus ring, so no keyboard handler is hand-rolled. The
      trailing chevron is `aria-hidden` and is the ONLY other interactive-
      looking element in the row; it must never become a second link/button.

   2. `last_batch === null` is the ONLY "never run" discriminant (AC-42,
      Contract & migration impact). `agent.trend` is a SEPARATE signal:
      `trend.length === 0` means "nothing measurable to plot" and can be true
      even when `last_batch` is non-null (every batch this agent ran had
      `traces_total = 0` and was excluded). So:
        - `last_batch === null`            → "never run" badge, `—` × 3, no
          sparkline.
        - `last_batch` set, `trend.length < SPARKLINE_MIN_POINTS` → real
          meta line + real numbers, but still no sparkline (AC-40; the
          vendored `Sparkline` would also emit a NaN path at exactly one
          point, `i / (data.length - 1)`).
        - `last_batch` set, `trend.length >= SPARKLINE_MIN_POINTS` → sparkline
          draws.
      Never branch on `trend.length === 0` to decide "never run".

   Untrusted inputs: `agent.name` and `agent.model` are free-form user input,
   rendered as escaped text nodes only (React's default JSX escaping — no
   `dangerouslySetInnerHTML`, no markup) and visually truncated via
   `overflow: hidden` + ellipsis rather than being allowed to break the row's
   layout. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge, Icon, Sparkline } from "@devdigest/ui";
import type { EvalAgentSummary } from "@devdigest/shared";
import { formatBatchDate, pct } from "../../helpers";
import { METRIC_COLOR, SPARKLINE_METRIC, SPARKLINE_MIN_POINTS, type MetricColorKey } from "../../constants";
import { s } from "./styles";

export function AgentRow({ agent }: { agent: EvalAgentSummary }) {
  const t = useTranslations("eval");
  const [hover, setHover] = React.useState(false);

  // The ONLY "never run" discriminant — never `agent.trend.length === 0`
  // (see the file-header seam note).
  const batch = agent.last_batch;

  // `EvalTrendPoint.recall` is always a number (never null) on the wire; the
  // cast reflects that contract, not a runtime guess — see `constants.ts`'s
  // doc comment on `SPARKLINE_METRIC`.
  const showSparkline = batch !== null && agent.trend.length >= SPARKLINE_MIN_POINTS;
  const sparklineData = showSparkline ? agent.trend.map((point) => point[SPARKLINE_METRIC] as number) : [];

  const stats: Array<{ key: MetricColorKey; label: string; value: string }> = [
    { key: "recall", label: t("dashboard.metricsShort.recall"), value: pct(batch ? batch.recall : null) },
    { key: "precision", label: t("dashboard.metricsShort.precision"), value: pct(batch ? batch.precision : null) },
    { key: "citation", label: t("dashboard.metricsShort.citation"), value: pct(batch ? batch.citation_accuracy : null) },
  ];

  return (
    <Link
      href={`/eval/${agent.agent_id}`}
      style={s.row(hover)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={s.iconTile}>
        <Icon.Cpu size={18} aria-hidden />
      </div>

      <div style={s.identity}>
        <div style={s.nameRow}>
          {/* Text node only — agent name is untrusted, free-form input. */}
          <span style={s.name}>{agent.name}</span>
          <Badge mono color="var(--text-secondary)" style={s.modelBadge}>
            {agent.model}
          </Badge>
        </div>
        {batch ? (
          <div style={s.meta}>
            {t("dashboard.overview.lastRun", {
              version: batch.agent_version,
              timestamp: formatBatchDate(batch.ran_at),
              passed: batch.traces_passed,
              total: batch.traces_total,
            })}
          </div>
        ) : (
          <Badge dot color="var(--text-muted)">
            {t("evalsTab.neverRun")}
          </Badge>
        )}
      </div>

      {showSparkline && (
        <div style={s.sparkline} data-testid="agent-row-sparkline" aria-hidden>
          <Sparkline data={sparklineData} color={METRIC_COLOR.recall} />
        </div>
      )}

      <div style={s.stats}>
        {stats.map((stat) => (
          <div key={stat.key} style={s.statBlock}>
            <span style={s.statLabel}>{stat.label}</span>
            <span className="tnum" style={s.statValue(METRIC_COLOR[stat.key])}>
              {stat.value}
            </span>
          </div>
        ))}
      </div>

      {/* Decorative affordance only (AC-37) — NOT a second navigation target. */}
      <Icon.ChevronRight size={16} aria-hidden style={s.chevron} />
    </Link>
  );
}
