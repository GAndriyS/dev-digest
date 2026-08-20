/* PrBriefCard — SPEC-04: the PR's "why + risk" brief. Sits on the Overview
   tab beside IntentCard and BlastTab as a third, independent card (AC-30);
   none of the other two change.

   Two independent data sources, on purpose:
    - `useBrief`/`useGenerateBrief` (this PR's stored/generated brief).
    - `usePrReviews` for the score — `reviews.score` of the newest row with
      `kind === 'review'` is the SINGLE source of truth (AC-47, AC-54); there
      is no `score` field on the brief contract, and regenerating the brief
      never moves it (AC-53) because the two hooks don't touch each other.

   `what`, `why`, `risks[].explanation` and `review_focus[].reason` are
   untrusted model text — rendered as plain React text nodes only, never
   through a Markdown/HTML renderer (AC-44). Review Focus rows are real
   `<button>`s (keyboard-operable, AC-33) when `onOpenFile` is supplied AND
   the row's path is in `navigablePaths` (or `navigablePaths` is omitted
   entirely — the card has no opinion about which paths are navigable until
   the caller tells it). A row whose path the caller marked as not navigable
   — e.g. it fell outside the Diff tab's current file list (AC-36) — renders
   as the SAME static, non-interactive markup used when `onOpenFile` is
   absent: never a button, not even a disabled one, so it is never announced,
   focusable or clickable. `onOpenFile` is optional so this card is fully
   self-contained until the caller wires the Diff tab navigation (SPEC-04
   step 11, lane B2). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Icon,
  SectionLabel,
  Skeleton,
} from "@devdigest/ui";
import type { Risk, RiskSeverity } from "@devdigest/shared";
import { useBrief, useGenerateBrief } from "@/lib/hooks/brief";
import { usePrReviews } from "@/lib/hooks/reviews";
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
  prId,
  onOpenFile,
  navigablePaths,
}: {
  prId: string | null;
  /** Opens the Diff tab with this repo-relative path expanded and scrolled
      into view (AC-34). Optional: absent it, Review Focus rows render as
      non-interactive text instead of controls with nowhere to go. */
  onOpenFile?: (path: string) => void;
  /** Paths the Diff tab can actually show — the caller's current PR file
      list. A Review Focus row renders as a `<button>` only when its path is
      in this set; when the set is omitted, every row with `onOpenFile` is
      treated as navigable (the card's pre-AC-36 default, kept so callers
      that don't yet know their file list still get working buttons). A row
      outside the set is never a button — not even a disabled-looking one —
      because the path it names cannot be shown (AC-36). */
  navigablePaths?: ReadonlySet<string>;
}) {
  const t = useTranslations("brief");
  const { data: brief, isLoading, isError, refetch } = useBrief(prId);
  const generate = useGenerateBrief(prId);
  // Independent of `brief` on purpose — see module doc above.
  const { data: reviews } = usePrReviews(prId);
  const latestReview = (reviews ?? []).find((r) => r.kind === "review");
  const score = latestReview?.score ?? null;

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
                this number is the reviewer agent's score, not part of the
                brief model's own output (AC-55). */}
            <div style={s.scoreWrap}>
              {score == null ? (
                <span style={s.scoreMuted}>{t("card.noScore")}</span>
              ) : (
                <span>
                  <span style={s.scoreValue}>{score}</span>
                  <span style={s.scoreLabel}>{t("card.scoreLabel")}</span>
                </span>
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

          <div>
            <div style={s.blockLabel}>{t("card.reviewFocus")}</div>
            {brief.review_focus.length === 0 ? (
              <div style={s.muted}>{t("card.reviewFocusEmpty")}</div>
            ) : (
              <ul style={s.focusList}>
                {brief.review_focus.map((item, i) => {
                  const canOpen =
                    onOpenFile != null &&
                    (navigablePaths == null || navigablePaths.has(item.path));
                  return (
                    <li key={i}>
                      {canOpen ? (
                        <button
                          type="button"
                          style={{ ...s.focusRowBase, ...s.focusRowInteractive }}
                          onClick={() => onOpenFile(item.path)}
                        >
                          <Icon.FileText size={14} style={s.focusIcon} />
                          <span className="mono" style={s.focusPath}>
                            {item.path}
                          </span>
                          <span style={s.focusReason}>{item.reason}</span>
                          <Icon.ArrowRight size={14} style={s.focusArrow} />
                        </button>
                      ) : (
                        <div style={{ ...s.focusRowBase, ...s.focusRowStatic }}>
                          <Icon.FileText size={14} style={s.focusIcon} />
                          <span className="mono" style={s.focusPath}>
                            {item.path}
                          </span>
                          <span style={s.focusReason}>{item.reason}</span>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
