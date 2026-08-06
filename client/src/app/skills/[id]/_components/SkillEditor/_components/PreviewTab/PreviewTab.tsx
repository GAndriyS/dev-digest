/* PreviewTab — the skill body rendered the way the reviewing agent receives it:
   the same Markdown, framed, with no editing affordances. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Markdown } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { s } from "./styles";

export function PreviewTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const hasBody = skill.body.trim().length > 0;

  return (
    <div style={s.wrap}>
      <h2 style={s.h2}>{t("preview.renderedTitle")}</h2>
      <p style={s.hint}>{t("preview.renderedHint")}</p>
      <div style={s.frame}>
        {hasBody ? <Markdown>{skill.body}</Markdown> : <div style={s.empty}>{t("preview.emptyBody")}</div>}
      </div>
    </div>
  );
}
