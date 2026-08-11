/* IntentCard — L03: the PR's derived intent, scope and risk areas, with a
   manual re-classify button (no auto re-derive on PR head move — this IS that
   button). Confidence and the `sources[]` provenance are stored on the record
   but deliberately not rendered: the card shows what the PR is about, not how
   sure the model was. Renders three states beyond the happy path: not classified
   yet, deriving, and a failed derive — the overview tab's own fetch must never
   read as a page error (e2e flow 02 opens this tab and waits on the title). */
"use client";

import React, { type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Icon,
  SectionLabel,
  Skeleton,
  type IconName,
} from "@devdigest/ui";
import { usePrIntent, useDeriveIntent } from "@/lib/hooks/reviews";
import { ApiError } from "@/lib/api";
import { CARD_SKELETON_HEIGHT, RISK_FALLBACK, RISK_TONES } from "./constants";
import { s } from "./styles";

/** The model writes intent text in Markdown — in practice almost entirely
    inline code spans around paths and identifiers, which read as literal
    backticks otherwise.

    The kit's `Markdown` cannot be used here: it is block-level (a `div` of
    `p`s), and this text has to sit inside a list row's flex line and inside a
    Badge's `span`, where a block wrapper is both wrong layout and invalid
    nesting. So this renders the same inline subset without the wrapper —
    `p` maps to a fragment. Block constructs a model might emit anyway
    (headings, fences) are unwrapped to their text rather than allowed to
    break the card's layout. Raw HTML stays escaped: no `rehype-raw`. */
function InlineMd({ children, codeStyle }: { children: string; codeStyle?: CSSProperties }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      disallowedElements={["h1", "h2", "h3", "h4", "h5", "h6", "pre", "hr", "img"]}
      unwrapDisallowed
      components={{
        p: ({ children }) => <>{children}</>,
        code: ({ children }) => (
          <code className="mono" style={{ ...s.code, ...codeStyle }}>
            {children}
          </code>
        ),
        strong: ({ children }) => <strong style={s.strong}>{children}</strong>,
        em: ({ children }) => <em>{children}</em>,
        a: ({ children, href }) => (
          <a href={href} style={s.link} target="_blank" rel="noreferrer noopener">
            {children}
          </a>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

/** Free-text risk area → the icon and tone it renders with. */
function riskStyle(area: string): { icon: IconName; chip: (typeof s)["riskCrit"] } {
  const hit = RISK_TONES.find((r) => r.pattern.test(area)) ?? RISK_FALLBACK;
  return { icon: hit.icon, chip: hit.tone === "crit" ? s.riskCrit : s.riskWarn };
}

/** One scope column. The two differ only in icon and tone, so the markup —
    including the decorative bullet — is shared rather than written twice. */
function ScopeColumn({
  icon,
  label,
  items,
  emptyLabel,
  headTone,
  itemTone,
}: {
  icon: IconName;
  label: string;
  items: string[];
  emptyLabel: string;
  headTone: CSSProperties;
  itemTone: CSSProperties;
}) {
  const I = Icon[icon];
  return (
    <div>
      <div style={{ ...s.colHead, ...headTone }}>
        <I size={13} />
        {label}
      </div>
      {items.length === 0 ? (
        <div style={s.muted}>{emptyLabel}</div>
      ) : (
        <ul style={s.list}>
          {items.map((item, i) => (
            <li key={i} style={{ ...s.item, ...itemTone }}>
              <span aria-hidden="true" style={s.bullet}>
                ·
              </span>
              <span>
                <InlineMd>{item}</InlineMd>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
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

          {/* The quote marks are decoration, so they sit outside the text node —
              which also keeps the intent itself exactly matchable in tests. */}
          <blockquote style={s.summary}>
            <span aria-hidden="true" style={s.quote}>
              &ldquo;
            </span>
            <span>
              <InlineMd>{intent.intent}</InlineMd>
            </span>
            <span aria-hidden="true" style={s.quote}>
              &rdquo;
            </span>
          </blockquote>

          <div style={s.columns}>
            <ScopeColumn
              icon="Check"
              label={t("card.inScope")}
              items={intent.in_scope}
              emptyLabel={t("card.none")}
              headTone={s.colHeadIn}
              itemTone={s.itemIn}
            />
            <ScopeColumn
              icon="X"
              label={t("card.outOfScope")}
              items={intent.out_of_scope}
              emptyLabel={t("card.none")}
              headTone={s.colHeadOut}
              itemTone={s.itemOut}
            />
          </div>

          {intent.risk_areas.length > 0 && (
            <>
              <hr style={s.divider} />
              <div>
                <div style={s.riskHead}>
                  <Icon.AlertTriangle size={13} />
                  {t("card.riskAreas")}
                </div>
                <div style={s.badgeRow}>
                  {intent.risk_areas.map((area) => {
                    const r = riskStyle(area);
                    return (
                      <Badge
                        key={area}
                        icon={r.icon}
                        color={r.chip.color}
                        bg={r.chip.background}
                        style={{ ...s.riskChip, border: r.chip.border }}
                      >
                        <InlineMd>{area}</InlineMd>
                      </Badge>
                    );
                  })}
                </div>
              </div>
            </>
          )}

        </div>
      )}
    </section>
  );
}
