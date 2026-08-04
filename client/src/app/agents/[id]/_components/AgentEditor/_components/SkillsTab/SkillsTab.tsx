/* Skills tab — a thin mount for the shared picker. The picker lives in
   src/components/ because the Skills Lab mounts it too, and a route tree may
   not import another route tree's internals. */
"use client";

import React from "react";
import { AgentSkillPicker } from "../../../../../../../components/agent-skill-picker";

export function SkillsTab({ agentId }: { agentId: string }) {
  return <AgentSkillPicker agentId={agentId} />;
}
