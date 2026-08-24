/* Context tab (AC-10/AC-11) — a thin mount for the shared picker. The picker
   lives in src/components/ because the Skill editor mounts it too, and a route
   tree may not import another route tree's internals. */
"use client";

import React from "react";
import { ContextDocPicker } from "../../../../../../../components/context-doc-picker";
import { useActiveRepo } from "../../../../../../../lib/repo-context";

export function ContextTab({ agentId }: { agentId: string }) {
  const { repoId } = useActiveRepo();
  return <ContextDocPicker repoId={repoId} ownerType="agent" ownerId={agentId} />;
}
