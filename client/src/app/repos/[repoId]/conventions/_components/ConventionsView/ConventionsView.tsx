/* ConventionsView — the Conventions Extractor's screen.

   Scan the clone, triage what came back, then merge the accepted rules into one
   skill. The list is deliberately flat and un-paginated: a scan returns a
   handful of candidates, and every one of them is a decision the user owes. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { useConventions, useExtractConventions, useUpdateConvention } from "@/lib/hooks/conventions";
import { ApiError } from "@/lib/api";
import { ConventionCandidateCard } from "./_components/ConventionCandidateCard";
import { CreateSkillModal } from "./_components/CreateSkillModal";
import { LOADING_CARDS } from "./constants";
import { acceptedOf, sortForReview } from "./helpers";
import { s } from "./styles";

export function ConventionsView() {
  // Reads its own route param rather than taking it as a prop, so the route
  // entry stays a server component like every other page in the app.
  const { repoId } = useParams<{ repoId: string }>();
  const t = useTranslations("conventions");
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const { data, isLoading, isError, refetch } = useConventions(repoId);
  const extract = useExtractConventions(repoId);
  const update = useUpdateConvention(repoId);
  const [creating, setCreating] = React.useState(false);

  const list = data ?? [];
  const accepted = acceptedOf(list);
  const repoName = activeRepo?.full_name ?? t("page.repoFallback");

  const crumb = [{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }];

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  const setStatus = (c: ConventionCandidate, status: ConventionCandidate["status"]) =>
    // Clicking the active state again clears it back to pending, so a misclick
    // is one click to undo rather than a dead end.
    update.mutate({ id: c.id, patch: { status: c.status === status ? "pending" : status } });

  const extractionError = extract.isError
    ? `${t("page.extractionFailed")}${
        extract.error instanceof ApiError ? ` — ${extract.error.message}` : ""
      }`
    : null;

  return (
    <AppShell crumb={crumb}>
      {creating && activeRepo && (
        <CreateSkillModal
          accepted={accepted}
          repoFullName={activeRepo.full_name}
          onClose={() => setCreating(false)}
        />
      )}

      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerMain}>
            <h1 style={s.h1}>
              {t("page.headingPrefix")}
              <span className="mono" style={s.repoName}>
                {repoName}
              </span>
            </h1>
            <p style={s.subtitle}>{t("page.subtitle")}</p>
          </div>
          <Button
            kind="secondary"
            icon="RefreshCw"
            loading={extract.isPending}
            disabled={extract.isPending}
            onClick={() => extract.mutate()}
          >
            {extract.isPending ? t("page.scanning") : t("page.rescan")}
          </Button>
        </div>

        {extractionError && (
          <div role="alert" style={s.error}>
            {extractionError}
          </div>
        )}

        {list.length > 0 && (
          <div style={s.toolbar}>
            <span style={s.count}>
              {t("page.acceptedCount", { accepted: accepted.length, total: list.length })}
            </span>
            <Button
              kind="primary"
              icon="Sparkles"
              disabled={accepted.length === 0 || !activeRepo}
              onClick={() => setCreating(true)}
            >
              {t("page.createSkill")}
            </Button>
          </div>
        )}

        {/* Outside the list guard on purpose. A scan where EVERY candidate was
            discarded returns an empty list, and without this the user would see
            "nothing found" — which reads as "this repo has no conventions" when
            what actually happened is that the model invented all of them. */}
        {extract.data && (
          <div style={s.scanSummary}>
            <span>{t("page.scanned", { files: extract.data.sampled_files.length })}</span>
            {extract.data.dropped_no_evidence > 0 && (
              <span style={s.dropped}>
                {t("page.droppedNoEvidence", { count: extract.data.dropped_no_evidence })}
              </span>
            )}
          </div>
        )}

        {isLoading ? (
          <div style={s.list}>
            {Array.from({ length: LOADING_CARDS }, (_, i) => (
              <Skeleton key={i} height={148} />
            ))}
          </div>
        ) : isError ? (
          <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />
        ) : list.length === 0 ? (
          <EmptyState
            icon="ListChecks"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            ctaLoading={extract.isPending}
            onCta={() => extract.mutate()}
          />
        ) : (
          <div style={s.list}>
            {sortForReview(list).map((c) => (
              <ConventionCandidateCard
                key={c.id}
                candidate={c}
                repoFullName={activeRepo?.full_name}
                defaultBranch={activeRepo?.default_branch}
                // Scoped to the row actually in flight. One shared mutation
                // means `update.isPending` alone would freeze every card on the
                // page for each click, and triage is rapid-fire by nature.
                pending={update.isPending && update.variables?.id === c.id}
                onStatus={(status) => setStatus(c, status)}
                onRule={(rule) => update.mutate({ id: c.id, patch: { rule } })}
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
