/* ConventionCandidateCard — one extracted house-rule awaiting a decision.

   Modeled on FindingCard: a claim, the code that proves it, a confidence bar,
   and accept/reject. The evidence is not decoration — it is the reason this
   list can be trusted, so the snippet and its `file:line` link are always
   visible rather than hidden behind an expander. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, MonoLink, ProgressBar, Textarea } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";
import { s } from "./styles";

export function ConventionCandidateCard({
  candidate,
  repoFullName,
  defaultBranch,
  pending,
  onStatus,
  onRule,
}: {
  candidate: ConventionCandidate;
  repoFullName?: string | null;
  defaultBranch?: string | null;
  pending?: boolean;
  onStatus: (status: ConventionCandidate["status"]) => void;
  onRule: (rule: string) => void;
}) {
  const t = useTranslations("conventions");
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(candidate.rule);

  const hasEvidence = candidate.evidence_path.length > 0;
  // The default branch stands in for a sha: a repo-level scan has no head
  // commit, and `blob/<branch>/<path>#L<n>` resolves the same way.
  const href =
    hasEvidence && repoFullName && defaultBranch
      ? githubBlobUrl(
          repoFullName,
          defaultBranch,
          candidate.evidence_path,
          candidate.evidence_line ?? undefined,
        )
      : undefined;
  const pathLabel = `${candidate.evidence_path}${
    candidate.evidence_line != null ? `:${candidate.evidence_line}` : ""
  }`;
  const confidencePct = Math.round(candidate.confidence * 100);

  const save = () => {
    const next = draft.trim();
    if (next.length > 0 && next !== candidate.rule) onRule(next);
    setEditing(false);
  };

  return (
    <div style={s.card(candidate.status)}>
      <div style={s.main}>
        {editing ? (
          <>
            <Textarea value={draft} onChange={setDraft} rows={2} />
            <div style={s.editRow}>
              <Button kind="primary" size="sm" icon="Check" onClick={save}>
                {t("card.save")}
              </Button>
              <Button
                kind="ghost"
                size="sm"
                onClick={() => {
                  setDraft(candidate.rule);
                  setEditing(false);
                }}
              >
                {t("card.cancel")}
              </Button>
            </div>
          </>
        ) : (
          <div style={s.rule}>{candidate.rule}</div>
        )}

        <div style={s.metaRow}>
          <Badge color="var(--sugg)">{candidate.category}</Badge>
          {candidate.status === "accepted" && (
            <Badge color="var(--ok)" dot>
              {t("card.accepted")}
            </Badge>
          )}
          {candidate.status === "rejected" && (
            <Badge color="var(--text-muted)" dot>
              {t("card.rejected")}
            </Badge>
          )}
        </div>

        {hasEvidence ? (
          <div style={s.snippetWrap}>
            <div style={s.snippetHead}>
              <div style={s.snippetPath}>
                <MonoLink href={href}>{pathLabel}</MonoLink>
              </div>
            </div>
            <pre className="mono" style={s.snippet}>
              {candidate.evidence_snippet}
            </pre>
          </div>
        ) : (
          <div style={s.confidenceLabel}>{t("card.evidenceMissing")}</div>
        )}

        <div style={s.confidenceRow}>
          <span style={s.confidenceLabel}>{t("card.confidence")}</span>
          <div style={s.bar}>
            <ProgressBar
              value={confidencePct}
              color={confidencePct >= 80 ? "var(--ok)" : "var(--warn)"}
            />
          </div>
          <span className="tnum" style={s.confidenceValue}>
            {confidencePct}%
          </span>
        </div>
      </div>

      <div style={s.actions}>
        <Button
          kind="primary"
          size="sm"
          icon="Check"
          disabled={pending}
          active={candidate.status === "accepted"}
          onClick={() => onStatus("accepted")}
        >
          {candidate.status === "accepted" ? t("card.accepted") : t("card.accept")}
        </Button>
        <Button
          kind="ghost"
          size="sm"
          icon="X"
          disabled={pending}
          active={candidate.status === "rejected"}
          onClick={() => onStatus("rejected")}
        >
          {candidate.status === "rejected" ? t("card.rejected") : t("card.reject")}
        </Button>
        {!editing && (
          <Button kind="ghost" size="sm" icon="Edit" disabled={pending} onClick={() => setEditing(true)}>
            {t("card.edit")}
          </Button>
        )}
      </div>
    </div>
  );
}
