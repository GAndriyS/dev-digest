/* Onboarding Tour — /repos/:repoId/onboarding (SPEC-03, L05). Five-section,
   read-only tour of an unfamiliar repo: architecture overview, critical paths,
   running it locally, a recommended reading order, and first tasks. Generated
   once (or re-generated) by an explicit `Generate` / `Regenerate` action —
   never automatically on open (AC-3, AC-5) — and cached per repo. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Button,
  EmptyState,
  ErrorState,
  Icon,
  IconBtn,
  Markdown,
  Skeleton,
} from "@devdigest/ui";
import type { OnboardingLink, OnboardingSection } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { MermaidDiagram } from "@/components/mermaid-diagram";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { useOnboardingTour, useGenerateOnboardingTour } from "@/lib/hooks/onboarding";
import { ApiError } from "@/lib/api";
import { COPY_CONFIRM_MS, OPEN_LINK_KINDS, SECTION_KINDS, LOADING_ROWS } from "./constants";
import { formatGeneratedAt, isEmptyTour, isSkeletonTour, sectionByKind, skeletonIconFor } from "./helpers";
import { s } from "./styles";
import { githubBlobUrl } from "@/lib/github-urls";

type Translate = ReturnType<typeof useTranslations>;

/** A repo-file reference row (`critical_paths`, `architecture_overview`
    references, `reading_path`, `first_tasks`). `Open` only renders for the
    kinds the tour is meant to link out for (AC-13, AC-14) — the rest show the
    path and the model's description as plain, escaped text. */
function LinkRow({
  link,
  showOpen,
  fullName,
  defaultBranch,
  t,
}: {
  link: OnboardingLink;
  showOpen: boolean;
  fullName?: string | null;
  defaultBranch?: string | null;
  t: Translate;
}) {
  const href =
    showOpen && fullName && defaultBranch ? githubBlobUrl(fullName, defaultBranch, link.path) : undefined;
  return (
    <li style={s.linkRow}>
      <div style={s.linkText}>
        <span className="mono" style={s.linkPath}>
          {link.path}
        </span>
        <span style={s.linkLabel}>{link.label}</span>
      </div>
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          style={s.openLink}
          aria-label={t("criticalPaths.openAria", { path: link.path })}
        >
          <Icon.ExternalLink size={13} />
          {t("criticalPaths.open")}
        </a>
      )}
    </li>
  );
}

/** One `run_locally` command: shown verbatim, copyable, never executed (AC-15,
    AC-16 — the button only ever writes to the clipboard). */
function CommandRow({ command, source, t }: { command: string; source?: string; t: Translate }) {
  const [copied, setCopied] = React.useState(false);
  // Same ref + cleanup shape as the Share handler: a collapse/unmount inside
  // the confirm window must not fire setState on an unmounted row.
  const timeout = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  React.useEffect(() => () => clearTimeout(timeout.current), []);
  const copy = () => {
    void navigator.clipboard?.writeText(command);
    setCopied(true);
    clearTimeout(timeout.current);
    timeout.current = setTimeout(() => setCopied(false), COPY_CONFIRM_MS);
  };
  return (
    <li style={s.commandRow}>
      <div style={s.commandMain}>
        <code className="mono" style={s.commandText}>
          {command}
        </code>
        {source && <span style={s.commandSource}>{source}</span>}
      </div>
      <IconBtn
        icon={copied ? "Check" : "Copy"}
        label={copied ? t("runLocally.copied") : t("runLocally.copyAria", { command })}
        onClick={copy}
      />
    </li>
  );
}

/** One collapsible section card. `null` `section` means the kind wasn't
    generated (shouldn't happen once `status: 'ready'` — sections always carry
    all five — but stays defensive rather than crashing on a partial payload). */
function SectionCard({
  kind,
  section,
  index,
  expanded,
  onToggle,
  registerRef,
  fullName,
  defaultBranch,
  t,
}: {
  kind: OnboardingSection["kind"];
  section: OnboardingSection | undefined;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  registerRef: (el: HTMLDivElement | null) => void;
  fullName?: string | null;
  defaultBranch?: string | null;
  t: Translate;
}) {
  if (!section) return null;
  const headingId = `onboarding-section-${kind}`;
  const panelId = `${headingId}-panel`;
  const showOpen = OPEN_LINK_KINDS.has(kind);

  return (
    <div ref={registerRef} data-section-kind={kind} id={headingId} style={s.card}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        title={expanded ? t("card.collapse") : t("card.expand")}
        style={s.cardHeader}
      >
        <span style={s.cardIndex}>{index + 1}</span>
        <span style={s.cardTitle}>{section.title}</span>
        <Icon.ChevronDown
          size={16}
          style={{ ...s.chevron, transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>
      {expanded && (
        <div id={panelId} style={s.cardBody}>
          {/* Model output, rendered as markdown only — no rehype-raw, so an
              embedded <script> in `body` never executes (AC-38). */}
          <Markdown>{section.body}</Markdown>
          {kind === "architecture_overview" && section.diagram && (
            <MermaidDiagram chart={section.diagram} />
          )}
          {/* AC-20: "no signals found" is code-enforced, not model-dependent —
              the server already guarantees `links: []` when no deterministic
              first-task signal exists, and this is the honest message for it. */}
          {kind === "first_tasks" && section.links.length === 0 && (
            <p style={s.noSignals}>{t("firstTasks.noSignals")}</p>
          )}
          {section.links.length > 0 &&
            (kind === "run_locally" ? (
              <ol style={s.linkList}>
                {section.links.map((link, i) => (
                  <CommandRow key={`${link.path}-${i}`} command={link.label} source={link.path} t={t} />
                ))}
              </ol>
            ) : (
              <ul style={s.linkList}>
                {section.links.map((link, i) => (
                  <LinkRow
                    key={`${link.path}-${i}`}
                    link={link}
                    showOpen={showOpen}
                    fullName={fullName}
                    defaultBranch={defaultBranch}
                    t={t}
                  />
                ))}
              </ul>
            ))}
        </div>
      )}
    </div>
  );
}

export function OnboardingTourView() {
  const t = useTranslations("onboarding");
  // Reads its own route param rather than taking it as a prop, so the route
  // entry stays a server component like every other page in the app.
  const { repoId } = useParams<{ repoId: string }>();
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const { data: tour, isLoading, isError, refetch } = useOnboardingTour(repoId);
  const generate = useGenerateOnboardingTour(repoId);

  const [collapsed, setCollapsed] = React.useState<Partial<Record<OnboardingSection["kind"], boolean>>>({});
  const [activeKind, setActiveKind] = React.useState<OnboardingSection["kind"]>(SECTION_KINDS[0]!);
  const [shareCopied, setShareCopied] = React.useState(false);
  const shareTimeout = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  const sectionRefs = React.useRef<Partial<Record<OnboardingSection["kind"], HTMLDivElement | null>>>({});

  const isFullTour = !!tour && !isSkeletonTour(tour) && !isEmptyTour(tour);

  // Scroll-spy for the "ON THIS PAGE" table of contents — an external system
  // (viewport intersection), not derived state, hence the effect. Guarded for
  // jsdom/test environments that don't implement IntersectionObserver.
  React.useEffect(() => {
    if (!isFullTour || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        const kind = visible?.target instanceof HTMLElement ? visible.target.dataset.sectionKind : undefined;
        if (kind) setActiveKind(kind as OnboardingSection["kind"]);
      },
      { rootMargin: "-15% 0px -70% 0px", threshold: 0 },
    );
    for (const kind of SECTION_KINDS) {
      const el = sectionRefs.current[kind];
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [isFullTour, tour?.generated_at]);

  React.useEffect(() => () => clearTimeout(shareTimeout.current), []);

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

  const handleGenerate = () => {
    if (generate.isPending) return;
    generate.mutate();
  };

  const handleShare = () => {
    void navigator.clipboard?.writeText(window.location.href);
    setShareCopied(true);
    clearTimeout(shareTimeout.current);
    shareTimeout.current = setTimeout(() => setShareCopied(false), COPY_CONFIRM_MS);
  };

  const toggleCollapsed = (kind: OnboardingSection["kind"]) =>
    setCollapsed((prev) => ({ ...prev, [kind]: !prev[kind] }));

  const scrollToSection = (kind: OnboardingSection["kind"]) => {
    sectionRefs.current[kind]?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveKind(kind);
  };

  const generateError = generate.isError
    ? `${t("generate.error")}${generate.error instanceof ApiError ? ` — ${generate.error.message}` : ""}`
    : null;

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        {generateError && (
          <div role="alert" style={s.errorBanner}>
            {generateError}
          </div>
        )}

        {isLoading ? (
          <div style={s.loadingList}>
            <h1 style={s.h1}>{t("title")}</h1>
            {Array.from({ length: LOADING_ROWS }, (_, i) => (
              <Skeleton key={i} height={80} />
            ))}
          </div>
        ) : isError || !tour ? (
          <ErrorState title={t("loadError.title")} onRetry={() => refetch()} />
        ) : isSkeletonTour(tour) ? (
          <EmptyState
            icon={skeletonIconFor(tour.reason)}
            title={t("skeleton.title")}
            body={t(`skeleton.reason.${tour.reason ?? "llm_failed"}`)}
            cta={t("skeleton.cta")}
            ctaLoading={generate.isPending}
            onCta={handleGenerate}
          />
        ) : isEmptyTour(tour) ? (
          <EmptyState
            icon="Sparkles"
            title={t("generate.title")}
            body={t("generate.body")}
            cta={t("generate.cta")}
            ctaLoading={generate.isPending}
            onCta={handleGenerate}
          />
        ) : (
          <>
            <div style={s.headerRow}>
              <div>
                <h1 style={s.h1}>{t("title")}</h1>
                <p style={s.subtitle}>
                  {t("subtitle", {
                    filesIndexed: tour.index.files_indexed,
                    totalCandidates: tour.index.total_candidates,
                    indexStatus: t(`indexStatus.${tour.index.status}`),
                    generatedAt: formatGeneratedAt(tour.generated_at) ?? "—",
                  })}
                </p>
              </div>
              <div style={s.headerActions}>
                <Button kind="secondary" icon="Link" onClick={handleShare}>
                  {t("shareLink.label")}
                </Button>
                {shareCopied && (
                  <span role="status" style={s.confirmBadge}>
                    {t("shareLink.copied")}
                  </span>
                )}
                <Button
                  kind="primary"
                  icon="RefreshCw"
                  loading={generate.isPending}
                  disabled={generate.isPending}
                  onClick={handleGenerate}
                >
                  {generate.isPending ? t("regenerating") : t("regenerate")}
                </Button>
              </div>
            </div>

            <div style={s.layout}>
              <nav aria-label={t("toc.heading")} style={s.toc}>
                <div style={s.tocHeading}>{t("toc.heading")}</div>
                <ul style={s.tocList}>
                  {SECTION_KINDS.map((kind) => (
                    <li key={kind}>
                      <button
                        type="button"
                        onClick={() => scrollToSection(kind)}
                        aria-current={activeKind === kind ? "true" : undefined}
                        style={s.tocItem(activeKind === kind)}
                      >
                        {t(`sections.${kind}`)}
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>

              <div style={s.sections}>
                {SECTION_KINDS.map((kind, i) => (
                  <SectionCard
                    key={kind}
                    kind={kind}
                    section={sectionByKind(tour.sections, kind)}
                    index={i}
                    expanded={!collapsed[kind]}
                    onToggle={() => toggleCollapsed(kind)}
                    registerRef={(el) => {
                      sectionRefs.current[kind] = el;
                    }}
                    fullName={activeRepo?.full_name}
                    defaultBranch={activeRepo?.default_branch}
                    t={t}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

export default OnboardingTourView;
