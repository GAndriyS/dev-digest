"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Icon,
  MonoLink,
  SectionLabel,
  Skeleton,
} from "@devdigest/ui";
import type { BlastRadius, DownstreamImpact } from "@devdigest/shared";
import { usePrBlast, useBlastSummary } from "@/lib/hooks/blast";
import { githubBlobUrl } from "@/lib/github-urls";
import { ApiError } from "@/lib/api";
import { BLAST_SKELETON_HEIGHT, DEFAULT_EXPANDED_SYMBOLS } from "./constants";
import { s } from "./styles";

/**
 * Blast Radius (L04) — "what else can this diff touch?".
 *
 * A tree over the repo-intel index: each symbol declared in the changed files,
 * the callers that reference it, and the endpoints/crons those reach. The map
 * itself costs nothing to open; the paragraph explaining it is an explicit
 * button, because that is the one thing here that spends a model call.
 *
 * `status` is rendered, never swallowed: a degraded index gets its own state
 * saying the index could not answer, which is a different statement from "no
 * caller depends on this code".
 */
export function BlastTab({
  prId,
  repoFullName,
  headSha,
}: {
  prId: string | null;
  repoFullName?: string | null;
  headSha?: string | null;
}) {
  const t = useTranslations("blast");
  const { data, isLoading, isError, refetch } = usePrBlast(prId);
  const summarize = useBlastSummary(prId);

  if (isLoading) return <Skeleton height={BLAST_SKELETON_HEIGHT} />;
  if (isError) return <ErrorState body={t("loadError")} onRetry={() => refetch()} />;
  if (!data) return <EmptyState icon="Target" title={t("empty.title")} body={t("empty.body")} />;

  // A degraded index is a statement about the INDEX, not about the code — so it
  // gets its own state with the reason, never the "nothing depends on this" one.
  if (data.status === "degraded") {
    return (
      <section>
        <SectionLabel icon="Target">{t("title")}</SectionLabel>
        <EmptyState
          icon="AlertTriangle"
          title={t("degraded.title")}
          body={t(`degraded.reason.${degradedReasonKey(data.reason)}`)}
        />
      </section>
    );
  }

  const summaryError = summarize.isError
    ? `${t("summary.failed")}${
        summarize.error instanceof ApiError ? ` — ${summarize.error.message}` : ""
      }`
    : null;

  return (
    <section>
      <SectionLabel
        icon="Target"
        right={
          <Button
            kind="secondary"
            size="sm"
            icon="Sparkles"
            loading={summarize.isPending}
            disabled={summarize.isPending || data.changed_symbols.length === 0}
            onClick={() => summarize.mutate()}
          >
            {summarize.isPending ? t("summary.pending") : t("summary.cta")}
          </Button>
        }
      >
        {t("title")}
      </SectionLabel>

      <div style={s.card}>
        {data.status === "partial" && (
          <div style={s.banner}>
            <Icon.AlertTriangle size={13} style={{ color: "var(--warn)", flexShrink: 0 }} />
            <span>{t("status.partial")}</span>
          </div>
        )}

        {data.indexed_sha && headSha && data.indexed_sha !== headSha && (
          <div style={s.banner}>
            <Icon.GitCommit size={13} style={{ color: "var(--warn)", flexShrink: 0 }} />
            <span>{t("indexedAt", { sha: data.indexed_sha.slice(0, 7) })}</span>
          </div>
        )}

        <StatsRow blast={data} />

        {summaryError && (
          <div role="alert" style={s.error}>
            {summaryError}
          </div>
        )}
        {summarize.data && <p style={s.summary}>{summarize.data.summary}</p>}

        {data.changed_symbols.length === 0 ? (
          <EmptyState icon="Target" title={t("empty.title")} body={t("empty.body")} />
        ) : (
          <div style={s.tree}>
            {data.downstream.map((impact, i) => (
              <SymbolNode
                key={impact.symbol}
                impact={impact}
                kind={data.changed_symbols.find((c) => c.name === impact.symbol)?.kind}
                defaultExpanded={i < DEFAULT_EXPANDED_SYMBOLS}
                repoFullName={repoFullName}
                // Lines come from the index, so they resolve against the commit
                // it was built at — linking them to the PR head would land on
                // whatever happens to sit at that line there.
                sha={data.indexed_sha ?? headSha}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * The server's `DegradedReason` union, narrowed to a key we actually have copy
 * for. An unrecognised reason falls back to `no_data` rather than rendering a
 * raw enum value at the reader.
 */
const DEGRADED_REASONS = [
  "flag_off",
  "index_failed",
  "index_partial",
  "repo_too_large",
  "no_changed_files",
  "no_data",
] as const;

function degradedReasonKey(reason: string | undefined): (typeof DEGRADED_REASONS)[number] {
  return DEGRADED_REASONS.find((r) => r === reason) ?? "no_data";
}

/** Counts across the whole map — the pre-seeded `stat.*` labels. */
function StatsRow({ blast }: { blast: BlastRadius }) {
  const t = useTranslations("blast");
  const callers = blast.downstream.reduce((n, d) => n + d.callers.length, 0);
  const endpoints = new Set(blast.downstream.flatMap((d) => d.endpoints_affected)).size;
  const crons = new Set(blast.downstream.flatMap((d) => d.crons_affected)).size;

  const items: Array<[string, number]> = [
    [t("stat.symbols"), blast.changed_symbols.length],
    [t("stat.callers"), callers],
    [t("stat.endpoints"), endpoints],
    [t("stat.crons"), crons],
  ];

  return (
    <div style={s.stats}>
      {items.map(([label, value]) => (
        <span key={label} style={s.stat}>
          <span style={s.statNum}>{value}</span> {label}
        </span>
      ))}
    </div>
  );
}

/** One changed symbol → its callers → the endpoints/crons they reach. */
function SymbolNode({
  impact,
  kind,
  defaultExpanded,
  repoFullName,
  sha,
}: {
  impact: DownstreamImpact;
  kind?: string;
  defaultExpanded: boolean;
  repoFullName?: string | null;
  /** The commit the line numbers resolve against — the indexed one. */
  sha?: string | null;
}) {
  const t = useTranslations("blast");
  const [expanded, setExpanded] = React.useState(defaultExpanded);
  const Caret = expanded ? Icon.ChevronDown : Icon.ChevronRight;

  return (
    <div>
      <button
        type="button"
        style={s.symbolRow}
        aria-expanded={expanded}
        onClick={() => setExpanded((e) => !e)}
      >
        <Caret size={14} style={s.arrow} />
        <Icon.Code size={13} style={s.arrow} />
        <span style={s.symbolName}>{impact.symbol}()</span>
        {kind && <span style={s.symbolKind}>{kind}</span>}
        <span style={s.callerCount}>{t("callerCount", { count: impact.callers.length })}</span>
      </button>

      {expanded && (
        <div style={s.branch}>
          {impact.callers.length === 0 ? (
            <span style={s.noDownstream}>{t("noDownstream", { count: 1 })}</span>
          ) : (
            impact.callers.map((c) => (
              <div key={`${c.file}:${c.line}:${c.name}`} style={s.callerRow}>
                <Icon.CornerDownRight size={12} style={s.arrow} />
                <MonoLink
                  href={
                    repoFullName && sha
                      ? githubBlobUrl(repoFullName, sha, c.file, c.line)
                      : undefined
                  }
                >
                  {c.file}:{c.line}
                </MonoLink>
                <span style={s.callerName}>{c.name}</span>
              </div>
            ))
          )}

          {(impact.endpoints_affected.length > 0 || impact.crons_affected.length > 0) && (
            <div style={s.chips}>
              {impact.endpoints_affected.map((e) => (
                <Chip key={e} icon="Globe">
                  {e}
                </Chip>
              ))}
              {impact.crons_affected.map((c) => (
                <Badge key={c} icon="Clock" color="var(--warn)" bg="var(--warn-bg)" mono>
                  {c}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
