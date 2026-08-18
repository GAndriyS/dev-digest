/* SkillSelectPrompt — the right column's content at exactly /skills, before a
   skill is chosen. Selecting a card is a route change (SkillsLabShell), not
   local state, so this is genuinely the whole page: nothing to wire up. */
"use client";

import { useTranslations } from "next-intl";
import { EmptyState } from "@devdigest/ui";
import { s } from "./styles";

export function SkillSelectPrompt() {
  const t = useTranslations("skills");
  return (
    <div style={s.wrap}>
      <EmptyState icon="Sparkles" title={t("page.selectPrompt.title")} body={t("page.selectPrompt.body")} />
    </div>
  );
}
