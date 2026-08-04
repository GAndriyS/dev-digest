/* EvalCaseModal — create or edit one eval case. `expected_output` is jsonb on
   the wire, so the shape written here is the one EvalsTab's readExpected()
   knows how to read back. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, Modal, SelectInput, TextInput, Textarea } from "@devdigest/ui";
import type { EvalCase, FindingCategory, Severity } from "@devdigest/shared";
import { useCreateEvalCase, useUpdateEvalCase } from "@/lib/hooks/skills";
import { CATEGORY_VALUES, SEVERITY_VALUES } from "../../constants";
import { readExpected, toExpectedOutput } from "../../helpers";
import { DIFF_ROWS, MODAL_WIDTH, NONE } from "./constants";
import { s } from "./styles";

export function EvalCaseModal({
  skillId,
  evalCase,
  onClose,
}: {
  skillId: string;
  /** null → create a new case; an EvalCase → edit it. */
  evalCase: EvalCase | null;
  onClose: () => void;
}) {
  const t = useTranslations("skills");
  const create = useCreateEvalCase();
  const update = useUpdateEvalCase();
  const initial = readExpected(evalCase?.expected_output);

  const [name, setName] = React.useState(evalCase?.name ?? "");
  const [diff, setDiff] = React.useState(evalCase?.input_diff ?? "");
  const [findings, setFindings] = React.useState(String(initial.findings));
  const [severity, setSeverity] = React.useState<string>(initial.severity ?? NONE);
  const [category, setCategory] = React.useState<string>(initial.category ?? NONE);

  const none = t("stats.noValue");
  const severityOptions = [
    { value: NONE, label: none },
    ...SEVERITY_VALUES.map((v) => ({ value: v, label: v })),
  ];
  const categoryOptions = [
    { value: NONE, label: none },
    ...CATEGORY_VALUES.map((v) => ({ value: v, label: v })),
  ];

  const count = Number.parseInt(findings, 10) || 0;
  // The server requires a severity on every expected finding, so "expect 2
  // findings" with no severity chosen is not expressible — block it here rather
  // than let the request 422.
  const needsSeverity = count > 0 && severity === NONE;
  const pending = create.isPending || update.isPending;
  const canSubmit =
    name.trim().length > 0 && diff.trim().length > 0 && !needsSeverity && !initial.mixed && !pending;

  const submit = async () => {
    const input = {
      name: name.trim(),
      input_diff: diff,
      expected_output: toExpectedOutput({
        findings: count,
        severity: severity === NONE ? null : (severity as Severity),
        category: category === NONE ? null : (category as FindingCategory),
        mixed: false,
      }),
    };
    if (evalCase) await update.mutateAsync({ skillId, id: evalCase.id, patch: input });
    else await create.mutateAsync({ skillId, input });
    onClose();
  };

  return (
    <Modal
      width={MODAL_WIDTH}
      title={evalCase ? t("evals.modal.editTitle") : t("evals.modal.createTitle")}
      subtitle={t("evals.modal.subtitle")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("evals.modal.cancel")}
          </Button>
          <Button kind="primary" icon="Check" onClick={submit} disabled={!canSubmit}>
            {pending ? t("evals.modal.saving") : t("evals.modal.save")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <FormField label={t("evals.modal.nameLabel")} required>
          <TextInput value={name} onChange={setName} placeholder={t("evals.modal.namePlaceholder")} />
        </FormField>
        <FormField label={t("evals.modal.diffLabel")} hint={t("evals.modal.diffHint")} required>
          <Textarea
            value={diff}
            onChange={setDiff}
            rows={DIFF_ROWS}
            mono
            placeholder={t("evals.modal.diffPlaceholder")}
          />
        </FormField>
        <FormField label={t("evals.modal.expectedLabel")} hint={t("evals.modal.expectedHint")}>
          <TextInput value={findings} onChange={setFindings} type="number" min={0} />
        </FormField>
        <div style={s.columns}>
          <div style={s.column}>
            <FormField label={t("evals.modal.severityLabel")}>
              <SelectInput value={severity} onChange={setSeverity} options={severityOptions} />
            </FormField>
          </div>
          <div style={s.column}>
            <FormField label={t("evals.modal.categoryLabel")}>
              <SelectInput value={category} onChange={setCategory} options={categoryOptions} />
            </FormField>
          </div>
        </div>
      </div>
    </Modal>
  );
}
