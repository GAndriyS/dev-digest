/* EvalCaseModal — create or edit one agent eval case (AC-10). `expected_output`
   is a raw JSON blob on the wire (`{ findings: [{file, start_line, end_line,
   severity?, category?, title?}] }` or `[]`), unlike the skill EvalCaseModal's
   severity/category form fields — agent scoring is file:line based (plan
   step 3), so this modal edits the JSON directly with a validity indicator
   instead of reconstructing a structured form the scorer does not read.
   Modelled on the skill EvalCaseModal's shape (Modal + FormField + footer),
   not shared with it (plan Non-goals / Recommendations R4).

   i18n note (seam item — see implementation report): the `caseEditor.*`
   namespace in messages/en/eval.json already carries exactly the field
   labels/JSON-validity words this modal needs (nameLabel, inputLabel,
   diffPlaceholder, expectedOutput, validJson, invalidJson, save, saving,
   caseTitle) — added in plan step 4 alongside evalsTab/dashboard/
   findingAction/compare, so it is reused here rather than duplicated. One
   string is genuinely missing from the file: a save-failure label (the
   skill modal's `evals.modal.saveFailed`). `common.actions.cancel` /
   `common.states.error` (an existing shared namespace, also already used by
   RepoNotFound) fill the Cancel button and the save-failure banner instead
   of hardcoding new copy or writing to messages/** (out of scope for this
   lane). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, Modal, Textarea, TextInput } from "@devdigest/ui";
import type { EvalCase } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { useCreateAgentEvalCase, useUpdateAgentEvalCase } from "@/lib/hooks/eval";
import { DIFF_ROWS, EXPECTED_ROWS, MODAL_WIDTH } from "./constants";
import { parseExpectedOutput, stringifyExpectedOutput } from "./helpers";
import { s } from "./styles";

export function EvalCaseModal({
  agentId,
  evalCase,
  onClose,
}: {
  agentId: string;
  /** null → create a new case; an EvalCase → edit it. */
  evalCase: EvalCase | null;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const tCommon = useTranslations("common");
  const create = useCreateAgentEvalCase();
  const update = useUpdateAgentEvalCase();

  const [name, setName] = React.useState(evalCase?.name ?? "");
  const [diff, setDiff] = React.useState(evalCase?.input_diff ?? "");
  const [expectedText, setExpectedText] = React.useState(
    stringifyExpectedOutput(evalCase?.expected_output),
  );

  const parsed = parseExpectedOutput(expectedText);
  const pending = create.isPending || update.isPending;
  // AC-10: invalid JSON blocks save outright, independent of the other fields.
  const canSubmit = name.trim().length > 0 && diff.trim().length > 0 && parsed.ok && !pending;

  const failed = create.isError || update.isError;
  const failure = create.error ?? update.error;

  // A failed save must keep the modal open with the authored diff/JSON intact:
  // it is the only copy, and closing on failure loses it. `catch` rather than
  // a bare `await` because an unhandled rejection is not an error state — the
  // alert below is, and `onClose` must not run past it.
  const submit = async () => {
    if (!parsed.ok) return;
    const input = { name: name.trim(), input_diff: diff, expected_output: parsed.value };
    try {
      if (evalCase) await update.mutateAsync({ agentId, id: evalCase.id, patch: input });
      else await create.mutateAsync({ owner_id: agentId, ...input });
    } catch {
      return;
    }
    onClose();
  };

  return (
    <Modal
      width={MODAL_WIDTH}
      title={evalCase ? t("caseEditor.caseTitle", { name: evalCase.name }) : t("evalsTab.newCase")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {tCommon("actions.cancel")}
          </Button>
          <Button kind="primary" icon="Check" onClick={submit} disabled={!canSubmit}>
            {pending ? t("caseEditor.saving") : t("caseEditor.save")}
          </Button>
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
      </div>
    </Modal>
  );
}
