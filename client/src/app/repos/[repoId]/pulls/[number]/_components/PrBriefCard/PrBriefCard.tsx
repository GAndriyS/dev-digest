/* PrBriefCard — SPEC-04 follow-up: region 1 of the Overview tab's three
   regions, full width (AC-56, AC-59). Prop-driven: `OverviewTab` reads the
   brief once through `usePrBriefSection` (AC-62) and hands this card the
   resulting view model — no hook call lives here anymore. Review Focus
   (region 3) has moved out entirely to `ReviewFocusPanel`, a sibling folder;
   this card carries the section header + Regenerate button, the generation
   error, the loading/error/empty states, the risk badge + stale badge +
   score, and the `what`/`why`/`risks[]` blocks — nothing else (AC-59, AC-60).

   `what`, `why` and `risks[].explanation` are untrusted model text —
   rendered as plain React text nodes only, never through a Markdown/HTML
   renderer (AC-44). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  CircularScore,
  EmptyState,
  ErrorState,
  Icon,
  SectionLabel,
  Skeleton,
} from "@devdigest/ui";
import type { PrWhyBrief, Risk, RiskSeverity } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { CARD_SKELETON_HEIGHT, RISK_LEVEL_TONE } from "./constants";
import { s } from "./styles";

function levelBadge(level: RiskSeverity) {
  const tone = RISK_LEVEL_TONE[level];
  return { icon: tone.icon, color: `var(--${tone.token})`, bg: `var(--${tone.token}-bg)` };
}

function RiskRow({ risk }: { risk: Risk }) {
  const tone = levelBadge(risk.severity);
  const I = Icon[tone.icon];
  return (
    <li style={s.riskItem}>
      <div style={s.riskTitleRow}>
        <I size={13} style={{ color: tone.color }} />
        <span style={s.riskTitle}>{risk.title}</span>
      </div>
      <span style={s.riskExplanation}>{risk.explanation}</span>
    </li>
  );
}

export function PrBriefCard({
  brief,
  isLoading,
  isError,
  refetch,
  score,
  generate,
}: {
  /** The stored brief, `null` before the first generation, `undefined`
      while the initial GET is still in flight — mirrors `useBrief`'s own
      states, read once by `OverviewTab` via `usePrBriefSection` (AC-62). */
  brief: PrWhyBrief | null | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  /** `reviews.score` of the newest `kind === 'review'` row, or `null` when
      the PR has no review yet (AC-47, AC-54). Independent of `brief` on
      purpose — regenerating the brief never moves it (AC-53). */
  score: number | null;
  generate: {
    mutate: () => void;
    isPending: boolean;
    isError: boolean;
    error: unknown;
  };
}) {
  const t = useTranslations("brief");

  const generateError = generate.isError
    ? `${t("card.generateFailed")}${generate.error instanceof ApiError ? ` — ${generate.error.message}` : ""}`
    : null;

  const levelTone = brief ? levelBadge(brief.risk_level) : null;
  const LevelIcon = levelTone ? Icon[levelTone.icon] : null;

  return (
    <section>
      <SectionLabel
        icon="AlertTriangle"
        right={
          <Button
            kind="secondary"
            size="sm"
            icon="RefreshCw"
            loading={generate.isPending}
            disabled={generate.isPending}
            onClick={() => generate.mutate()}
          >
            {generate.isPending ? t("card.regenerating") : t("card.regenerate")}
          </Button>
        }
      >
        {t("card.title")}
      </SectionLabel>

      {generateError && (
        <div role="alert" style={{ ...s.error, marginBottom: 12 }}>
          {generateError}
        </div>
      )}

      {isLoading ? (
        <Skeleton height={CARD_SKELETON_HEIGHT} />
      ) : isError ? (
        <ErrorState body={t("card.loadError")} onRetry={() => refetch()} />
      ) : !brief ? (
        <EmptyState
          icon="AlertTriangle"
          title={t("card.emptyTitle")}
          body={t("card.emptyBody")}
          cta={t("card.emptyCta")}
          ctaLoading={generate.isPending}
          onCta={() => generate.mutate()}
        />
      ) : (
        <div style={s.card}>
          <div style={s.topRow}>
            {levelTone && LevelIcon && (
              <Badge icon={levelTone.icon} color={levelTone.color} bg={levelTone.bg}>
                {t(`card.riskLevel.${brief.risk_level}`)}
              </Badge>
            )}
            {brief.stale && (
              <Badge color="var(--warn)" dot>
                {t("card.stale")}
              </Badge>
            )}
            {/* Subtitled and visually separate from what/why/risk_level —
                this donut is the reviewer agent's score, not part of the
                brief model's own output (AC-55). Same primitive, same
                dimensions as the PR list's score column (AC-68). When there
                is no score yet, the donut doesn't render at all — no empty
                ring, no zero (AC-48). */}
            <div style={s.scoreWrap}>
              {score == null ? (
                <span style={s.scoreMuted}>{t("card.noScore")}</span>
              ) : (
                <>
                  <CircularScore score={score} size={34} stroke={3} />
                  <span style={s.scoreLabel}>{t("card.scoreLabel")}</span>
                </>
              )}
            </div>
          </div>

          <div>
            <div style={s.blockLabel}>{t("card.what")}</div>
            <p style={s.blockText}>{brief.what}</p>
          </div>
          <div>
            <div style={s.blockLabel}>{t("card.why")}</div>
            <p style={s.blockText}>{brief.why}</p>
          </div>

          {brief.risks.length > 0 && (
            <div>
              <div style={s.blockLabel}>{t("card.risks")}</div>
              <ul style={s.risksList}>
                {brief.risks.map((risk, i) => (
                  <RiskRow key={i} risk={risk} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
