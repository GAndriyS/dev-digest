/* FindingCard — ported from findings.jsx (createElement → TSX).
   Severity icon+label, category, file:line, confidence, markdown rationale +
   suggestion, accept/dismiss actions. Accept/dismiss reflect persisted
   timestamps. Also owns "Turn into eval case" (L06 AC-1/AC-2/AC-5/AC-6): a
   third action in the same row, self-contained (its own mutation, its own
   pending state) since — unlike accept/dismiss — it needs no `prId`-scoped
   query invalidation from the parent panel. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Icon,
  SeverityBadge,
  CategoryTag,
  MonoLink,
  ConfidenceNum,
  Button,
  Markdown,
  type Severity,
  type Category,
} from "@devdigest/ui";
import type { FindingRecord, FindingActionKind } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { notify } from "@/lib/toast";
import { useCreateEvalCaseFromFinding } from "@/lib/hooks/eval";
import { SEV_COLOR, SEV_COLOR_FALLBACK } from "./constants";
import { lineLabel } from "./helpers";
import { githubBlobUrl } from "../../../../../../../lib/github-urls";
import { s } from "./styles";

/** The service's 422 code for "the finding's file has no diff text to build
    an eval case from" (`server/src/modules/eval/service.ts`) — the one 422
    this button has a dedicated, translated explanation for (AC-5). Any other
    failure (e.g. `eval_case_no_agent`) falls through to the app-wide error
    toast that every other mutation already relies on. */
const NO_DIFF_CODE = "eval_case_no_diff";

export function FindingCard({
  f,
  focused,
  defaultExpanded,
  onAction,
  pending,
  repoFullName,
  headSha,
}: {
  f: FindingRecord;
  focused?: boolean;
  defaultExpanded?: boolean;
  onAction?: (action: FindingActionKind, reply?: string) => void;
  pending?: boolean;
  repoFullName?: string | null;
  headSha?: string | null;
}) {
  const t = useTranslations("prReview");
  const tEval = useTranslations("eval");
  const router = useRouter();
  const createEvalCase = useCreateEvalCaseFromFinding();
  const [expanded, setExpanded] = React.useState(defaultExpanded ?? false);
  const sevColor = SEV_COLOR[f.severity] ?? SEV_COLOR_FALLBACK;
  const fileHref =
    repoFullName && headSha
      ? githubBlobUrl(repoFullName, headSha, f.file, f.start_line, f.end_line)
      : undefined;
  const accepted = !!f.accepted_at;
  const dismissed = !!f.dismissed_at;
  const muted = accepted || dismissed;
  // AC-1/AC-2: "Turn into eval case" is only active once the finding has a
  // decision — accept/dismiss already collapse to exactly this condition.
  const hasDecision = muted;
  const evalDisabledReasonId = `finding-eval-disabled-${f.id}`;

  async function handleTurnIntoEvalCase() {
    try {
      const { case: evalCase, created } = await createEvalCase.mutateAsync(f.id);
      notify.success(tEval(created ? "findingAction.created" : "findingAction.opened"));
      // AC-6: both the just-created (201) and the already-existing (200) case
      // open the same way — the case lives in its owning agent's editor.
      router.push(`/agents/${evalCase.owner_id}?tab=evals`);
    } catch (err) {
      // AC-5: this button explains its one expected 422 itself. The mutation
      // opts out of the app-wide toast (`meta.ownErrorToast`, providers.tsx)
      // — otherwise one click stacked the raw server message on top of this
      // translated one — so every other failure has to be surfaced here too.
      if (err instanceof ApiError && err.code === NO_DIFF_CODE) {
        notify.error(tEval("findingAction.noPatch"));
      } else {
        notify.error(err instanceof Error ? err.message : tEval("findingAction.failed"));
      }
    }
  }

  return (
    <div data-finding-id={f.id} style={s.card(!!focused, sevColor, muted)}>
      <div onClick={() => setExpanded((e) => !e)} style={s.header}>
        <div style={s.badgeWrap}>
          <SeverityBadge severity={f.severity as Severity} compact />
        </div>
        <div style={s.headerMain}>
          <div style={s.titleRow}>
            <span style={s.title(muted, dismissed)}>{f.title}</span>
            <CategoryTag category={f.category as Category} />
            {accepted && <span style={s.acceptedTag}>{t("finding.accepted")}</span>}
            {dismissed && <span style={s.dismissedTag}>{t("finding.dismissed")}</span>}
          </div>
          <div style={s.metaRow}>
            <MonoLink href={fileHref}>
              {f.file}:{lineLabel(f)}
            </MonoLink>
            <ConfidenceNum value={f.confidence} />
          </div>
        </div>
        <Icon.ChevronDown size={16} style={s.chevron(expanded)} />
      </div>

      {expanded && (
        <div style={s.body}>
          <div style={s.prose}>
            <Markdown>{f.rationale}</Markdown>
          </div>
          {f.suggestion && (
            <div style={s.suggestionWrap}>
              <div style={s.suggestionLabel}>{t("finding.suggestedFix")}</div>
              <div style={s.prose}>
                <Markdown>{f.suggestion}</Markdown>
              </div>
            </div>
          )}

          <div style={s.actions}>
            <Button
              kind="secondary"
              size="sm"
              icon="Check"
              disabled={pending}
              active={accepted}
              onClick={() => onAction?.("accept")}
            >
              {t("finding.accept")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="X"
              disabled={pending}
              active={dismissed}
              onClick={() => onAction?.("dismiss")}
            >
              {t("finding.dismiss")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="FlaskConical"
              loading={createEvalCase.isPending}
              disabled={!hasDecision}
              title={hasDecision ? undefined : tEval("findingAction.disabledReason")}
              aria-describedby={hasDecision ? undefined : evalDisabledReasonId}
              onClick={handleTurnIntoEvalCase}
            >
              {tEval("findingAction.turnIntoEvalCase")}
            </Button>
            {!hasDecision && (
              <span id={evalDisabledReasonId} style={s.srOnly}>
                {tEval("findingAction.disabledReason")}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
