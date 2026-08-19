/* SkillDirtyGate — the cross-route seam AC-7 needs. ConfigTab's `dirty` flag
   lives several segments below SkillsLabShell in the tree
   (skills/[id]/_components/SkillEditor/_components/ConfigTab), so it cannot
   reach the shell's "switch skill" decision as a prop. SkillsLabShell owns the
   `dirty` value itself — a plain useState next to `selectSkill`, so gating a
   navigation needs no round trip through context — and only ever hands
   descendants the setter down through this provider. ConfigTab is the only
   writer today (AC-7 only ever asks about the config form); a future tab with
   its own unsaved draft would register through the same hook.

   A consumer rendered outside the provider (SkillEditor.test.tsx renders the
   editor on its own, with no shell above it) degrades to a no-op setter
   rather than throwing — the same default-context shape as
   src/lib/repo-context.tsx and SkillEvalRun. */
"use client";

import React from "react";

type SetDirty = (dirty: boolean) => void;

const NOOP: SetDirty = () => {};
const SkillDirtyGateCtx = React.createContext<SetDirty>(NOOP);

export function SkillDirtyGateProvider({
  onDirtyChange,
  children,
}: {
  onDirtyChange: SetDirty;
  children: React.ReactNode;
}) {
  return <SkillDirtyGateCtx.Provider value={onDirtyChange}>{children}</SkillDirtyGateCtx.Provider>;
}

/**
 * Registers the calling tab's own `dirty` boolean with the gate above it.
 * Two effects, not one: the first mirrors `dirty` up on every change: the
 * second only ever runs its cleanup, on unmount, so a truly-gone editor never
 * leaves a stale "dirty" flag registered above it. ConfigTab stays mounted
 * across a tab switch of the same skill (see SkillEditor.tsx's hidden-not-
 * unmounted Config pane), so in practice the unmount case only fires when the
 * whole detail column goes away — navigating back to /skills, or the
 * selected skill itself disappearing (AC-6).
 */
export function useRegisterSkillDirty(dirty: boolean): void {
  const setDirty = React.useContext(SkillDirtyGateCtx);

  React.useEffect(() => {
    setDirty(dirty);
  }, [dirty, setDirty]);

  React.useEffect(() => {
    return () => setDirty(false);
    // Unmount-only: registering a fresh cleanup per `setDirty` identity would
    // fire early were setDirty ever to change identity mid-life; it doesn't
    // (SkillsLabShell's setState setter is stable), so an empty dep array is
    // exact, not a lint workaround.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
