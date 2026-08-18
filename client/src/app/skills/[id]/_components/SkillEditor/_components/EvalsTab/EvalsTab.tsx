/* EvalsTab — regression tests for a skill: a diff in, an expected finding count
   out. Run state (results by case_id, running, noProviderKey) is NOT owned
   here any more: it lives in the SkillEvalRun seam above both this tab and
   the detail header's "Run on evals" button (L05 step 5), so a header-
   triggered run and this tab's own "Run"/"Run all" buttons show the same
   results. See SkillEvalRun.tsx for the merge-not-replace reasoning that used
   to live in this file next to the state it now travels with. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, IconBtn, Skeleton } from "@devdigest/ui";
import type { EvalCase, Skill } from "@devdigest/shared";
import { useDeleteEvalCase } from "@/lib/hooks/skills";
import { useSkillEvalRun } from "../../../SkillEvalRun";
import { EvalCaseModal } from "./_components/EvalCaseModal";
import { OUTCOME_COLORS } from "./constants";
import { actualFindings, caseOutcome, countPassing, readExpected } from "./helpers";
import { s } from "./styles";

export function EvalsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const { cases, isLoading, isError, refetch, results, running, noProviderKey, runOne, runAll } =
    useSkillEvalRun();
  const del = useDeleteEvalCase();

  /** undefined = modal closed, null = creating, EvalCase = editing. */
  const [editing, setEditing] = React.useState<EvalCase | null | undefined>(undefined);

  const list = cases;
  const passed = countPassing(list, results);

  const onDelete = (c: EvalCase) => {
    if (!window.confirm(t("evals.deleteConfirm", { name: c.name }))) return;
    del.mutate({ skillId: skill.id, id: c.id });
  };

  if (isError) return <ErrorState body={t("evals.loadError")} onRetry={() => refetch()} />;
  if (isLoading) return <Skeleton height={200} />;

  return (
    <div style={s.wrap}>
      {editing !== undefined && (
        <EvalCaseModal
          skillId={skill.id}
          evalCase={editing}
          onClose={() => setEditing(undefined)}
        />
      )}

      <div style={s.header}>
        <h2 style={s.h2}>{t("evals.title")}</h2>
        {list.length > 0 && (
          <Badge color={passed === list.length ? "var(--ok)" : "var(--text-secondary)"}>
            {t("evals.passing", { passed, total: list.length })}
          </Badge>
        )}
        <div style={s.actions}>
          <Button
            kind="secondary"
            size="sm"
            icon="Play"
            onClick={runAll}
            disabled={noProviderKey || running || list.length === 0}
          >
            {running ? t("evals.running") : t("evals.runAll")}
          </Button>
          <Button kind="primary" size="sm" icon="Plus" onClick={() => setEditing(null)}>
            {t("evals.add")}
          </Button>
        </div>
      </div>
      <p style={s.hint}>{t("evals.subtitle")}</p>

      {noProviderKey && (
        <div role="alert" style={s.notice}>
          {t("evals.noProviderKey")}
        </div>
      )}

      {list.length === 0 ? (
        <EmptyState
          icon="FlaskConical"
          title={t("evals.empty.title")}
          body={t("evals.empty.body")}
          cta={t("evals.empty.cta")}
          onCta={() => setEditing(null)}
        />
      ) : (
        <div style={s.list}>
          {list.map((c) => {
            const run = results[c.id];
            const outcome = caseOutcome(run);
            const expected = readExpected(c.expected_output);
            const actual = actualFindings(run);
            return (
              <div key={c.id} style={s.row}>
                <Badge color={OUTCOME_COLORS[outcome]} dot>
                  {t(`evals.state.${outcome}`)}
                </Badge>
                <span style={s.name}>{c.name}</span>
                <span className="tnum" style={s.meta}>
                  {actual == null
                    ? t("evals.expected", { expected: expected.findings })
                    : t("evals.expectedGot", { expected: expected.findings, actual })}
                </span>
                {(expected.severity || expected.category) && (
                  <Badge color="var(--text-muted)" mono>
                    {[expected.severity, expected.category].filter(Boolean).join(" · ")}
                  </Badge>
                )}
                <div style={s.rowActions}>
                  <Button
                    kind="secondary"
                    size="sm"
                    icon="Play"
                    onClick={() => runOne(c.id)}
                    disabled={noProviderKey || running}
                  >
                    {t("evals.run")}
                  </Button>
                  <IconBtn icon="Edit" label={t("evals.edit")} onClick={() => setEditing(c)} />
                  <IconBtn icon="Trash" label={t("evals.delete")} onClick={() => onDelete(c)} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
