/* One row of the skill picker. Presentational: every decision (what "linked"
   means, where a moved row lands) belongs to AgentSkillPicker. Internal to the
   folder — not exported from index.ts. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Checkbox, Icon, IconBtn } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { s } from "./styles";

export interface SkillRowProps {
  skill: Skill;
  linked: boolean;
  onToggle: () => void;
  /** 1-based position in the assembled prompt. Linked rows only. */
  position?: number;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  dragging?: boolean;
  dropTarget?: boolean;
  /** Drag handlers, spread onto the row. Absent for unlinked rows (nothing to order). */
  dragProps?: React.HTMLAttributes<HTMLLIElement>;
}

export function SkillRow({
  skill,
  linked,
  onToggle,
  position,
  onMoveUp,
  onMoveDown,
  canMoveUp = false,
  canMoveDown = false,
  dragging = false,
  dropTarget = false,
  dragProps,
}: SkillRowProps) {
  const t = useTranslations("agents");
  const draggable = dragProps !== undefined;
  return (
    <li
      {...dragProps}
      draggable={draggable}
      style={s.row(linked, dragging, dropTarget)}
      data-skill={skill.name}
    >
      <span style={s.grip(draggable)} aria-hidden="true">
        <Icon.Menu size={13} />
      </span>
      {position != null && <span className="tnum" style={s.position}>{position}</span>}
      <div style={s.main}>
        <Checkbox
          checked={linked}
          onChange={onToggle}
          label={<span style={s.name}>{skill.name}</span>}
        />
        {skill.description && (
          <span style={s.description} title={skill.description}>
            {skill.description}
          </span>
        )}
      </div>
      <Badge color="var(--text-secondary)">{skill.type}</Badge>
      <div style={s.controls}>
        {onMoveUp && (
          <span style={s.arrow(canMoveUp)}>
            <IconBtn
              icon="ArrowUp"
              size={26}
              label={t("skills.moveUp", { name: skill.name })}
              onClick={onMoveUp}
            />
          </span>
        )}
        {onMoveDown && (
          <span style={s.arrow(canMoveDown)}>
            <IconBtn
              icon="ArrowDown"
              size={26}
              label={t("skills.moveDown", { name: skill.name })}
              onClick={onMoveDown}
            />
          </span>
        )}
      </div>
    </li>
  );
}
