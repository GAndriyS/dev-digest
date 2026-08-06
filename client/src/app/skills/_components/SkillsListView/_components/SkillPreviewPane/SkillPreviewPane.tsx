/* SkillPreviewPane — the side preview of the /skills grid. Selecting a card
   answers two questions here without leaving the list: what the skill IS (name,
   description, type, source, version, enabled) and what it SAYS (its body
   rendered the way the reviewing agent receives it). Editing is still a route
   change, so the pane ends with the way into /skills/:id. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Markdown } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { isUntrusted, typeColor } from "../../helpers";
import { s } from "./styles";

export function SkillPreviewPane({
  skill,
  onOpenEditor,
}: {
  skill: Skill;
  onOpenEditor: () => void;
}) {
  const t = useTranslations("skills");
  const hasBody = skill.body.trim().length > 0;

  return (
    <div style={s.wrap}>
      <div style={s.titleRow}>
        <h2 style={s.name}>{skill.name}</h2>
        <Badge color="var(--text-secondary)" mono>
          {t("preview.version", { version: skill.version })}
        </Badge>
      </div>

      <p style={s.description}>{skill.description || t("listItem.noDescription")}</p>

      <div style={s.badgeRow}>
        <Badge color={typeColor(skill.type)}>{t(`listItem.type.${skill.type}`)}</Badge>
        <Badge color="var(--text-muted)">{t(`listItem.source.${skill.source}`)}</Badge>
        <Badge color={skill.enabled ? "var(--ok)" : "var(--text-muted)"} dot>
          {skill.enabled ? t("preview.enabled") : t("preview.disabled")}
        </Badge>
      </div>

      {isUntrusted(skill.source) && (
        <div style={s.notice}>
          <Badge color="var(--warn)" icon="AlertTriangle">
            {t("preview.untrustedBadge")}
          </Badge>
          <p style={s.noticeBody}>{t("preview.untrustedNotice")}</p>
        </div>
      )}

      <div style={s.actions}>
        <Button kind="secondary" size="sm" icon="ExternalLink" onClick={onOpenEditor}>
          {t("preview.openInEditor")}
        </Button>
      </div>

      <h3 style={s.h3}>{t("preview.renderedTitle")}</h3>
      <p style={s.hint}>{t("preview.renderedHint")}</p>
      <div style={s.frame}>
        {hasBody ? (
          <Markdown>{skill.body}</Markdown>
        ) : (
          <div style={s.empty}>{t("preview.emptyBody")}</div>
        )}
      </div>
    </div>
  );
}
