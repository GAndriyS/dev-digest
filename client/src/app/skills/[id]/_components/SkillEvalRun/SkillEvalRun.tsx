/* SkillEvalRun — the one owner of eval-run state (results by case_id, running,
   noProviderKey) shared between two consumers that are NOT parent/child of
   each other in a way that lets props reach between them: the "Run on evals"
   button in the detail header (SkillDetailView) and the Evals tab
   (SkillEditor's EvalsTab). SkillEditor.tsx sits in between as a thin tab
   shell this plan does not touch (L05 step 5 owns SkillEvalRun/**,
   SkillDetailView/** and EvalsTab/** — not SkillEditor.tsx), so the shared
   state cannot travel down as a new prop through it. It travels through this
   context instead: SkillDetailView wraps both the header button and
   `<SkillEditor>` in one SkillEvalRunProvider, and each consumer reads it with
   useSkillEvalRun().

   Both consumers read the SAME useSkillEvalCases() query
   (["skill-eval-cases", id]) through this one Provider instance, so opening
   the Evals tab after a header-triggered run never issues a second request
   for the case list — only a cache read. */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import type { EvalCase, EvalRun, Skill } from "@devdigest/shared";
import { useRunAllEvals, useRunEvalCase, useSkillEvalCases } from "@/lib/hooks/skills";
import { indexRunsByCase, isNoProviderKey } from "./helpers";

export interface SkillEvalRunState {
  cases: EvalCase[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  results: Record<string, EvalRun>;
  running: boolean;
  runningAll: boolean;
  noProviderKey: boolean;
  hasCases: boolean;
  runOne: (id: string) => void;
  runAll: () => void;
}

const EMPTY_STATE: SkillEvalRunState = {
  cases: [],
  isLoading: false,
  isError: false,
  refetch: () => {},
  results: {},
  running: false,
  runningAll: false,
  noProviderKey: false,
  hasCases: false,
  runOne: () => {},
  runAll: () => {},
};

// A no-op empty state, not a throw, mirrors src/lib/repo-context.tsx: a
// consumer rendered outside the provider (a future standalone test, say)
// degrades to "nothing to run" instead of crashing. In the real tree
// SkillDetailView always wraps both consumers.
const SkillEvalRunCtx = React.createContext<SkillEvalRunState>(EMPTY_STATE);

export function SkillEvalRunProvider({
  skill,
  children,
}: {
  skill: Skill;
  children: React.ReactNode;
}) {
  const { data: cases, isLoading, isError, refetch } = useSkillEvalCases(skill.id);
  const runOneMut = useRunEvalCase();
  const runAllMut = useRunAllEvals();
  const [results, setResults] = React.useState<Record<string, EvalRun>>({});

  const list = cases ?? [];

  // Once the API has said "no key", every further run would 409 too — disable
  // the buttons and explain instead of firing requests that cannot succeed.
  const noProviderKey = isNoProviderKey(runOneMut.error) || isNoProviderKey(runAllMut.error);
  const running = runOneMut.isPending || runAllMut.isPending;
  // `running` is the combined disable flag (any run in flight blocks every
  // other run button, same as before this state moved into a shared seam).
  // `runningAll` stays specific to the run-all mutation so the "Run all"
  // button's own label only reads "Running…" during an actual run-all, not
  // while a single case is running via runOne — matching the pre-L05 EvalsTab
  // (`runAll.isPending ? … : …` on its own local mutation object). Collapsing
  // both into one flag would make a single-case run show "Running…" on a
  // button that has not been clicked.
  const runningAll = runAllMut.isPending;

  const runOne = (id: string) =>
    runOneMut.mutate(
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
  //
  // This reasoning — and the merge itself — used to live in EvalsTab.tsx next
  // to its own `results` state. It moved here with the state when eval-run
  // ownership became a route-level seam (L05 step 5); it did not get dropped
  // in the move.
  const runAll = () =>
    runAllMut.mutate(skill.id, {
      onSuccess: (runs) => setResults((prev) => ({ ...prev, ...indexRunsByCase(list, runs) })),
    });

  const value: SkillEvalRunState = {
    cases: list,
    isLoading,
    isError,
    refetch,
    results,
    running,
    runningAll,
    noProviderKey,
    hasCases: list.length > 0,
    runOne,
    runAll,
  };

  return <SkillEvalRunCtx.Provider value={value}>{children}</SkillEvalRunCtx.Provider>;
}

export function useSkillEvalRun(): SkillEvalRunState {
  return React.useContext(SkillEvalRunCtx);
}

/**
 * The header's "Run on evals" trigger (AC-16/17/18): fires the exact same
 * POST /skills/:id/eval-run as the Evals tab's own "Run all" button (both go
 * through this seam's `runAll`) and switches the URL to `?tab=evals` so the
 * per-case results are visible immediately — one URLSearchParams mutation,
 * one navigation, never two sequential setParam calls that would race each
 * other on the same useSearchParams() snapshot (client/INSIGHTS.md,
 * 2026-08-11).
 *
 * Disabled with no eval cases, while a run is in flight, or once a 409 has
 * already said no provider key is configured — reusing isNoProviderKey and
 * the evals.noProviderKey copy rather than a second copy of either; the
 * explanation itself stays on the Evals tab (the tab this button switches
 * to), and the button only surfaces it as a title for a quick hover.
 */
export function RunEvalsButton({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const search = useSearchParams();
  const { hasCases, isLoading, isError, running, noProviderKey, runAll } = useSkillEvalRun();

  const disabled = isLoading || isError || running || noProviderKey || !hasCases;

  const onClick = () => {
    runAll();
    const sp = new URLSearchParams(search?.toString() ?? "");
    sp.set("tab", "evals");
    router.replace(`/skills/${skill.id}?${sp.toString()}`);
  };

  return (
    <Button
      kind="secondary"
      size="sm"
      icon="Play"
      onClick={onClick}
      disabled={disabled}
      title={noProviderKey ? t("evals.noProviderKey") : undefined}
    >
      {t("detail.runEvals")}
    </Button>
  );
}
