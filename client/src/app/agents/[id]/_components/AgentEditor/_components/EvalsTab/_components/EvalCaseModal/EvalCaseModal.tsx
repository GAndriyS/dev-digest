/* EvalCaseModal — create or edit one agent eval case (AC-10), plus the L06
   expectation-kind slice this plan adds: a POSITIVE/NEGATIVE banner reading
   the case's STORED `expectation_kind` (AC-60/61), a stored-vs-actual
   mismatch warning (AC-58), a per-case run ("Run case" / "Run on save",
   AC-63/64/67/68) and an `Actual output` panel (AC-65/66/69).
   `expected_output` is a raw JSON blob on the wire (`{ findings: [{file,
   start_line, end_line, severity?, category?, title?}] }` or `[]`), unlike
   the skill EvalCaseModal's severity/category form fields — agent scoring is
   file:line based (plan step 3), so this modal edits the JSON directly with
   a validity indicator instead of reconstructing a structured form the
   scorer does not read. Modelled on the skill EvalCaseModal's shape (Modal +
   FormField + footer), not shared with it (plan Non-goals / Recommendations
   R4).

   Props (pinned across steps 9 and 10 — plan's "Contract & migration
   impact", "Lane-internal contract"): `lastRun` absent/`undefined` means
   this case has never run (AC-66) — never a zero-filled `EvalRunRecord`.
   After a run completes here, the panel shows the mutation's OWN returned
   record (`ranRecord` below) and never merges it with the incoming prop —
   the prop may be stale (this page's last load), the mutation result is not.

   i18n note (seam item — see implementation report): the `caseEditor.*`
   namespace in messages/en/eval.json already carries exactly the field
   labels/JSON-validity words this modal needs (nameLabel, inputLabel,
   diffPlaceholder, expectedOutput, validJson, invalidJson, save, saving,
   caseTitle) plus every L06 addition this step consumes (subtitle*, banner.*,
   actualOutput, neverRun, runOnSave, runFailed, runNeedsSave, runCase,
   running, lastRunPassed, lastRunFailed, resultSummary) — added in plan
   steps 3/4, so all of it is reused here rather than duplicated. One string
   is genuinely missing from the file: a save-failure label (the skill
   modal's `evals.modal.saveFailed`). `common.actions.cancel` /
   `common.states.error` (an existing shared namespace, also already used by
   RepoNotFound) fill the Cancel button and the save-failure banner instead
   of hardcoding new copy or writing to messages/** (out of scope for this
   lane). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, Modal, Textarea, TextInput, Toggle } from "@devdigest/ui";
import type { EvalCase, EvalRunRecord } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { isNoProviderKeyError, useCreateAgentEvalCase, useRunAgentEvalCase, useUpdateAgentEvalCase } from "@/lib/hooks/eval";
import { caseOrigin, expectationKindOf, expectationMismatch, expectedFindings } from "../../helpers";
import { DIFF_ROWS, EXPECTED_ROWS, MODAL_WIDTH, SUBTITLE_KEY } from "./constants";
import {
  durationSeconds,
  expectedFindingLocator,
  parseExpectedOutput,
  pctMetric,
  stringifyExpectedOutput,
  summarizeActualFinding,
} from "./helpers";
import { s } from "./styles";

export function EvalCaseModal({
  agentId,
  evalCase,
  lastRun,
  onClose,
}: {
  agentId: string;
  /** null → create a new case; an EvalCase → edit it. */
  evalCase: EvalCase | null;
  /** The case's most recent run BEFORE this modal opened — `undefined` when
      it has never run (AC-66). Never a zero-filled `EvalRunRecord`; see the
      file header for why a completed run here never merges into this prop. */
  lastRun?: EvalRunRecord;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const tCommon = useTranslations("common");
  const create = useCreateAgentEvalCase();
  const update = useUpdateAgentEvalCase();
  const run = useRunAgentEvalCase();

  const [name, setName] = React.useState(evalCase?.name ?? "");
  const [diff, setDiff] = React.useState(evalCase?.input_diff ?? "");
  const [expectedText, setExpectedText] = React.useState(
    stringifyExpectedOutput(evalCase?.expected_output),
  );
  // AC-67: off at every opening, never persisted — this component remounts
  // fresh every time the tab opens it (EvalsTab renders it only while
  // `editing !== undefined`), so a plain `useState(false)` already resets on
  // every open without an effect.
  const [runOnSave, setRunOnSave] = React.useState(false);
  // The mutation's OWN returned record, once a run completes from THIS
  // modal session — takes over the panel from `lastRun` and is never merged
  // with it (file header, AC-70's "no client-side merging" rule).
  const [ranRecord, setRanRecord] = React.useState<EvalRunRecord | undefined>(undefined);

  const parsed = parseExpectedOutput(expectedText);
  const pending = create.isPending || update.isPending;
  // AC-10: invalid JSON blocks save outright, independent of the other fields.
  const canSubmit = name.trim().length > 0 && diff.trim().length > 0 && parsed.ok && !pending;

  const failed = create.isError || update.isError;
  const failure = create.error ?? update.error;

  // AC-68: once the run endpoint has said "no key", every further attempt
  // would 409 too — disable both the button and the toggle and explain,
  // rather than firing requests that cannot succeed (mirrors the batch
  // Run button in EvalsTab.tsx and `RunEvalsButton` in SkillEvalRun.tsx).
  const noProviderKey = isNoProviderKeyError(run.error);
  // A run REJECTED for a reason other than "no key" (case/agent not found —
  // Contract & migration impact's 404 row) is a distinct, unusual failure
  // from a SCORED-but-errored run (`displayedRun.error`, a 200 body) — both
  // read through the same `caseEditor.runFailed` copy so the panel never has
  // two different shapes for "the run did not produce a result".
  const runRejected = !noProviderKey && run.isError;
  const runRejectedReason =
    runRejected && run.error instanceof Error ? run.error.message : runRejected ? String(run.error) : null;

  // Never a zero-filled object (AC-66) — `undefined` when neither this
  // session's own run nor the incoming prop has one.
  const displayedRun = ranRecord ?? lastRun;

  // A failed save must keep the modal open with the authored diff/JSON intact:
  // it is the only copy, and closing on failure loses it. `catch` rather than
  // a bare `await` because an unhandled rejection is not an error state — the
  // alert below is, and `onClose` must not run past it.
  const submit = async () => {
    if (!parsed.ok) return;
    const input = { name: name.trim(), input_diff: diff, expected_output: parsed.value };
    try {
      const savedCase = evalCase
        ? await update.mutateAsync({ agentId, id: evalCase.id, patch: input })
        : await create.mutateAsync({ owner_id: agentId, ...input });
      if (runOnSave) {
        try {
          const result = await run.mutateAsync({ agentId, caseId: savedCase.id });
          setRanRecord(result);
        } catch {
          // Surfaced via `run.isError`/`noProviderKey` above — the save
          // itself already succeeded, so there is nothing to roll back.
        }
        // AC-65 would be unobservable if the modal closed on this path —
        // Decisions taken: "the modal stays open after a Run on save save".
        return;
      }
    } catch {
      return;
    }
    onClose();
  };

  // AC-64: disabled while pending is not enough on its own — a second click
  // in the same tick before React re-renders must still be a no-op (mirrors
  // EvalsTab.tsx's `onRun`). `mutateAsync`, not `mutate`, so this modal reads
  // the resolved record directly rather than relying on a per-call callback.
  const onRunCase = async () => {
    if (!evalCase || run.isPending || noProviderKey) return;
    try {
      const result = await run.mutateAsync({ agentId, caseId: evalCase.id });
      setRanRecord(result);
    } catch {
      // Surfaced via `run.isError`/`noProviderKey` above.
    }
  };

  const kind = evalCase ? expectationKindOf(evalCase) : null;
  const mismatch = evalCase ? expectationMismatch(evalCase) : null;
  const origin = evalCase ? caseOrigin(evalCase) : "manual";

  return (
    <Modal
      width={MODAL_WIDTH}
      title={evalCase ? t("caseEditor.caseTitle", { name: evalCase.name }) : t("caseEditor.newCase")}
      subtitle={t(SUBTITLE_KEY[origin])}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          {(noProviderKey || !evalCase) && (
            <div role="alert" style={s.disabledReason}>
              {noProviderKey ? t("evalsTab.noProviderKey") : t("caseEditor.runNeedsSave")}
            </div>
          )}
          <div style={s.footerRow}>
            <Button kind="ghost" onClick={onClose}>
              {tCommon("actions.cancel")}
            </Button>
            <div style={s.runControls}>
              {/* The vendored Toggle has no `disabled` prop (only Button
                  does — client/src/vendor/ui is do-not-touch), so AC-68's
                  "disable the toggle" is a guarded onChange (it never flips
                  state while disabled) plus an aria-disabled wrapper plus
                  the visible reason above — never a prop that does not
                  exist on the component. */}
              <span style={s.toggleWrap} aria-disabled={noProviderKey}>
                <Toggle on={runOnSave} onChange={(v) => { if (!noProviderKey) setRunOnSave(v); }} />
              </span>
              <span style={s.toggleLabel}>{t("caseEditor.runOnSave")}</span>
              <Button
                kind="secondary"
                icon="Play"
                onClick={onRunCase}
                disabled={!evalCase || run.isPending || noProviderKey}
              >
                {run.isPending ? t("caseEditor.running") : t("caseEditor.runCase")}
              </Button>
              <Button kind="primary" icon="Check" onClick={submit} disabled={!canSubmit}>
                {pending ? t("caseEditor.saving") : t("caseEditor.save")}
              </Button>
            </div>
          </div>
        </div>
      }
    >
      <div style={s.body}>
        {failed && (
          <div role="alert" style={s.error}>
            {tCommon("states.error")}
            {failure instanceof ApiError ? ` — ${failure.message}` : null}
          </div>
        )}

        {evalCase && kind === "must_find" && (
          <div style={s.bannerPositive}>
            <div style={s.bannerTitle}>{t("caseEditor.banner.positiveTitle")}</div>
            {expectedFindings(evalCase.expected_output).map((finding, i) => {
              const locator = expectedFindingLocator(finding);
              return (
                <div key={i} style={s.bannerLine}>
                  {t("caseEditor.banner.mustFind", {
                    title: locator.title ?? evalCase.name,
                    file: locator.file,
                    line: locator.line,
                  })}
                </div>
              );
            })}
          </div>
        )}
        {evalCase && kind === "must_not_flag" && (
          <div style={s.bannerNegative}>
            <div style={s.bannerTitle}>{t("caseEditor.banner.negativeTitle")}</div>
            <div style={s.bannerLine}>{t("caseEditor.banner.mustNotFlag")}</div>
          </div>
        )}
        {mismatch && (
          <div role="alert" style={s.mismatch}>
            {t("evalsTab.kindMismatch", { kind: mismatch.kind, count: mismatch.count })}
          </div>
        )}

        <FormField label={t("caseEditor.nameLabel")} required>
          <TextInput value={name} onChange={setName} placeholder={t("caseEditor.namePlaceholder")} />
        </FormField>
        <FormField label={t("caseEditor.inputLabel")} required>
          <Textarea
            value={diff}
            onChange={setDiff}
            rows={DIFF_ROWS}
            mono
            placeholder={t("caseEditor.diffPlaceholder")}
          />
        </FormField>
        <FormField
          label={t("caseEditor.expectedOutput")}
          right={
            <span style={parsed.ok ? s.validBadge : s.invalidBadge}>
              {parsed.ok ? t("caseEditor.validJson") : t("caseEditor.invalidJson")}
            </span>
          }
          hint={!parsed.ok ? t("caseEditor.invalidJson") : undefined}
        >
          <Textarea value={expectedText} onChange={setExpectedText} rows={EXPECTED_ROWS} mono />
        </FormField>

        <div style={s.actualOutput}>
          <div style={s.actualOutputTitle}>{t("caseEditor.actualOutput")}</div>
          {runRejectedReason != null ? (
            <p style={s.runFailed}>{t("caseEditor.runFailed", { reason: runRejectedReason })}</p>
          ) : displayedRun === undefined ? (
            // AC-66: no run object at all, never a zero-filled metrics
            // object read as a result (the same rule EvalsTab.tsx documents
            // for `dashboard.current`).
            <p style={s.neverRun}>{t("caseEditor.neverRun")}</p>
          ) : displayedRun.error ? (
            // AC-69: the reason, never the diff text — `error.message` is
            // built server-side from the case name and/or the underlying
            // error only (runner.ts `describeCaseFailure`).
            <p style={s.runFailed}>{t("caseEditor.runFailed", { reason: displayedRun.error.message })}</p>
          ) : (
            <>
              <p style={displayedRun.pass ? s.passLabel : s.failLabel}>
                {t(displayedRun.pass ? "caseEditor.lastRunPassed" : "caseEditor.lastRunFailed")}
              </p>
              <p className="tnum" style={s.resultSummary}>
                {t("caseEditor.resultSummary", {
                  recall: pctMetric(displayedRun.recall),
                  precision: pctMetric(displayedRun.precision),
                  citation: pctMetric(displayedRun.citation_accuracy),
                  duration: durationSeconds(displayedRun.duration_ms),
                })}
              </p>
              {/* `actual_output` is `unknown` on the wire — `expectedFindings`
                  (../../helpers.ts) reads a `.findings` array off any object
                  generically, which is exactly the shape the runner persists
                  for BOTH expected and actual output. Text nodes only, never
                  markup: this is the model's own output. */}
              {expectedFindings(displayedRun.actual_output).length > 0 && (
                <ul style={s.findingsList}>
                  {expectedFindings(displayedRun.actual_output).map((finding, i) => (
                    <li key={i} style={s.findingItem}>
                      {summarizeActualFinding(finding)}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
