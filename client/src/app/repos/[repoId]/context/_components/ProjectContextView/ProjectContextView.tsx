/* Project Context — /repos/:repoId/context (A3, L05). Read-only: list + search
   + preview, no Edit/Save/+/upload (interview Q2 — see Non-goals). Selection
   lives in ?path=, so a linked document is a shareable URL. */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Card, EmptyState, ErrorState, Icon, Markdown, Skeleton, TextInput } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { useContextDoc, useContextFiles } from "@/lib/hooks/core";
import { LOADING_ROWS } from "./constants";
import { formatScannedAt, matchesFilter, sumTokensEst } from "./helpers";
import { s } from "./styles";

export function ProjectContextView() {
  const t = useTranslations("context");
  // Reads its own route param rather than taking it as a prop, so the route
  // entry stays a server component like every other page in the app.
  const { repoId } = useParams<{ repoId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const path = search.get("path");
  const [query, setQuery] = React.useState("");

  const { data: listing, isLoading, isError, refetch } = useContextFiles(repoId);
  const docQuery = useContextDoc(repoId, path);

  const select = (p: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("path", p);
    router.replace(`/repos/${repoId}/context?${sp.toString()}`);
  };

  const repoName = activeRepo?.full_name ?? repoId;
  const crumb = [
    { label: repoName, mono: true, href: `/repos/${repoId}/pulls` },
    { label: t("title") },
  ];

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  const files = listing?.files ?? [];
  const shown = files.filter((f) => matchesFilter(f, query));
  // The used_by_agents count is listing-only (never on a single-doc read), so
  // it comes from the file the user picked in the list, not from docQuery.
  const selected = files.find((f) => f.path === path) ?? null;

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div style={s.header}>
          <h1 style={s.h1}>{t("title")}</h1>
        </div>

        {isLoading ? (
          <div style={s.list}>
            {Array.from({ length: LOADING_ROWS }, (_, i) => (
              <Skeleton key={i} height={40} />
            ))}
          </div>
        ) : isError ? (
          <ErrorState title={t("page.loadErrorTitle")} onRetry={() => refetch()} />
        ) : files.length === 0 ? (
          <EmptyState
            icon="Folder"
            title={t("page.empty.title")}
            body={t("page.empty.body", { roots: (listing?.roots ?? []).join(", ") })}
          />
        ) : (
          <>
            <div style={s.searchWrap}>
              <TextInput value={query} onChange={setQuery} placeholder={t("page.searchPlaceholder")} />
            </div>

            {listing?.truncated && (
              <div role="status" style={s.banner}>
                {t("page.truncatedBanner", { shown: files.length, total: listing.total })}
              </div>
            )}

            <div style={s.layout(!!path)}>
              <ul style={s.list}>
                {shown.map((f) => (
                  <li key={f.path}>
                    <Card hover pad onClick={() => select(f.path)} style={f.path === path ? s.cardSelected : s.card}>
                      <div style={s.row}>
                        <Icon.FileText size={14} style={s.icon} />
                        <span className="mono" style={s.path}>
                          {f.path}
                        </span>
                        {f.root && <Badge color="var(--text-secondary)">{f.root}</Badge>}
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>

              {path ? (
                <div style={s.preview}>
                  <div style={s.previewHeader}>
                    <span className="mono" style={s.previewPath}>
                      {path}
                    </span>
                    {selected?.used_by_agents != null && (
                      <Badge icon="Users">{t("page.usedByAgents", { count: selected.used_by_agents })}</Badge>
                    )}
                  </div>
                  {docQuery.isLoading ? (
                    <Skeleton height={160} />
                  ) : docQuery.isError ? (
                    <span>{t("page.previewLoadError")}</span>
                  ) : (
                    // AC-6: rendered by the same Markdown primitive as everywhere
                    // else — never dangerouslySetInnerHTML, so an embedded
                    // <script> in an attached document cannot execute here.
                    <Markdown>{docQuery.data?.content}</Markdown>
                  )}
                </div>
              ) : (
                <div style={s.previewEmpty}>{t("page.selectPrompt")}</div>
              )}
            </div>

            <div style={s.footer}>
              {t("page.footer", {
                files: files.length,
                tokens: sumTokensEst(files),
                time: listing ? formatScannedAt(listing.scanned_at) : "",
              })}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

export default ProjectContextView;
