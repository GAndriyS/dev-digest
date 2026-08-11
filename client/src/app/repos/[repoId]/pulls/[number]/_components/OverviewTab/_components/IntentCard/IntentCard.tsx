/* IntentCard — L03: the PR's derived intent, scope, risk areas and confidence,
   with a manual re-classify button (no auto re-derive on PR head move — this
   IS that button). Renders three states beyond the happy path: not classified
   yet, deriving, and a failed derive — the overview tab's own fetch must never
   read as a page error (e2e flow 02 opens this tab and waits on the title). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, ConfidenceNum, EmptyState, ErrorState, SectionLabel, Skeleton } from "@devdigest/ui";
import type { IntentSource } from "@devdigest/shared";
import { usePrIntent, useDeriveIntent } from "@/lib/hooks/reviews";
import { ApiError } from "@/lib/api";
import { CARD_SKELETON_HEIGHT } from "./constants";
import { s } from "./styles";

/** One `sources[]` entry → its display label. Unavailable entries say so —
    they're the reason a low confidence is explainable, not just a number. */
function sourceLabel(source: IntentSource, t: ReturnType<typeof useTranslations>): string {
  const kind =
    source.type === "description"
      ? t("card.sourceDescription")
      : source.type === "linked_issue"
        ? t("card.sourceLinkedIssue", { ref: source.ref ?? "" })
        : t("card.sourceRepoFile", { ref: source.ref ?? "" });
  return source.status === "unavailable" ? `${kind} — ${t("card.sourceUnavailable")}` : kind;
}

export function IntentCard({ prId, headSha }: { prId: string | null; headSha: string }) {
  const t = useTranslations("intent");
  const { data: intent, isLoading, isError, refetch } = usePrIntent(prId);
  const derive = useDeriveIntent(prId);

  const isStale = !!intent?.head_sha && intent.head_sha !== headSha;
  const deriveError = derive.isError
    ? `${t("card.deriveFailed")}${derive.error instanceof ApiError ? ` — ${derive.error.message}` : ""}`
    : null;

  return (
    <section>
      <SectionLabel
        icon="Target"
        right={
          <Button
            kind="secondary"
            size="sm"
            icon="RefreshCw"
            loading={derive.isPending}
            disabled={derive.isPending}
            onClick={() => derive.mutate()}
          >
            {derive.isPending ? t("card.reclassifying") : t("card.reclassify")}
          </Button>
        }
      >
        {t("card.title")}
      </SectionLabel>

      {deriveError && (
        <div role="alert" style={{ ...s.error, marginBottom: 12 }}>
          {deriveError}
        </div>
      )}

      {isLoading ? (
        <Skeleton height={CARD_SKELETON_HEIGHT} />
      ) : isError ? (
        <ErrorState body={t("card.loadError")} onRetry={() => refetch()} />
      ) : !intent ? (
        <EmptyState
          icon="Target"
          title={t("card.emptyTitle")}
          body={t("card.emptyBody")}
          cta={t("card.emptyCta")}
          ctaLoading={derive.isPending}
          onCta={() => derive.mutate()}
        />
      ) : (
        <div style={s.card}>
          {isStale && (
            <div style={s.staleRow}>
              <Badge color="var(--warn)" dot>
                {t("card.stale")}
              </Badge>
            </div>
          )}

          <blockquote style={s.summary}>{intent.intent}</blockquote>

          <div style={s.columns}>
            <div>
              <div style={s.subLabel}>{t("card.inScope")}</div>
              {intent.in_scope.length === 0 ? (
                <div style={s.muted}>{t("card.none")}</div>
              ) : (
                <ul style={s.list}>
                  {intent.in_scope.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div style={s.subLabel}>{t("card.outOfScope")}</div>
              {intent.out_of_scope.length === 0 ? (
                <div style={s.muted}>{t("card.none")}</div>
              ) : (
                <ul style={s.list}>
                  {intent.out_of_scope.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {intent.risk_areas.length > 0 && (
            <div>
              <div style={s.subLabel}>{t("card.riskAreas")}</div>
              <div style={s.badgeRow}>
                {intent.risk_areas.map((area) => (
                  <Badge key={area} color="var(--warn)">
                    {area}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <div style={s.footer}>
            <ConfidenceNum value={intent.confidence} />
            {intent.sources.length > 0 && (
              <div style={s.sources}>
                {intent.sources.map((source, i) => (
                  <span key={i} style={source.status === "unavailable" ? s.sourceUnavailable : undefined}>
                    {sourceLabel(source, t)}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
