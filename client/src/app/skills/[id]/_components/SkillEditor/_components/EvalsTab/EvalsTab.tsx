/* EvalsTab — regression tests for a skill: a diff in, an expected finding count
   out. Run results are view state, not server state: a run is an event, so it
   lives here for the session rather than in the query cache. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, IconBtn, Skeleton } from "@devdigest/ui";
import type { EvalCase, EvalRun, Skill } from "@devdigest/shared";
import {
  useDeleteEvalCase,
  useRunAllEvals,
  useRunEvalCase,
  useSkillEvalCases,
} from "@/lib/hooks/skills";
import { EvalCaseModal } from "./_components/EvalCaseModal";
import { OUTCOME_COLORS } from "./constants";
import {
  actualFindings,
  caseOutcome,
  countPassing,
  indexRunsByCase,
  isNoProviderKey,
  readExpected,
} from "./helpers";
import { s } from "./styles";

export function EvalsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const { data: cases, isLoading, isError, refetch } = useSkillEvalCases(skill.id);
  const runOne = useRunEvalCase();
  const runAll = useRunAllEvals();
  const del = useDeleteEvalCase();

  const [results, setResults] = React.useState<Record<string, EvalRun>>({});
  /** undefined = modal closed, null = creating, EvalCase = editing. */
  const [editing, setEditing] = React.useState<EvalCase | null | undefined>(undefined);

  const list = cases ?? [];
  // Once the API has said "no key", every further run would 409 too — disable
  // the buttons and explain instead of firing requests that cannot succeed.
  const noProviderKey = isNoProviderKey(runOne.error) || isNoProviderKey(runAll.error);
  const running = runOne.isPending || runAll.isPending;
  const passed = countPassing(list, results);

  const onRunOne = (id: string) =>
    runOne.mutate(
      { skillId: skill.id, id },
      { onSuccess: (run) => setResults((prev) => ({ ...prev, [id]: run })) },
    );

  // Merge, never replace. Replacing the map made this callback's result depend
  // on `list` as captured when the click happened: a case added or removed by a
  // refetch in flight would drop every result keyed off the old list, and a
  // single run that landed in between would be discarded. Merging keeps both —
  // the run-all entries win for the cases it actually ran, and nothing else is
  // touched. (The buttons are also disabled while any run is pending, so the
  // overlap is narrow; this makes the state update correct rather than merely
  // unlikely to be wrong.)
  const onRunAll = () =>
    runAll.mutate(skill.id, {
      onSuccess: (runs) => setResults((prev) => ({ ...prev, ...indexRunsByCase(list, runs) })),
    });

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
            onClick={onRunAll}
            disabled={noProviderKey || running || list.length === 0}
          >
            {runAll.isPending ? t("evals.running") : t("evals.runAll")}
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
                    onClick={() => onRunOne(c.id)}
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
