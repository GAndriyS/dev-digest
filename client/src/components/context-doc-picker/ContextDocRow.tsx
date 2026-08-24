/* One row of the context doc picker. Presentational: every decision (what
   "attached" means, where a moved row lands, what "missing" means) belongs to
   ContextDocPicker. Internal to the folder — not exported from index.ts. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Checkbox, Icon, IconBtn } from "@devdigest/ui";
import type { SpecFile } from "@devdigest/shared";
import { s } from "./styles";

export interface ContextDocRowProps {
  path: string;
  /** `null` ⇒ attached earlier but no longer in the listing (deleted / truncated). */
  file: SpecFile | null;
  attached: boolean;
  onToggle: () => void;
  /** 1-based position in the assembled prompt. Attached rows only. */
  position?: number;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  dragging?: boolean;
  dropTarget?: boolean;
  /** Drag handlers, spread onto the row. Absent for unlinked rows (nothing to order). */
  dragProps?: React.HTMLAttributes<HTMLLIElement>;
  previewing?: boolean;
  onTogglePreview?: () => void;
  previewBody?: React.ReactNode;
}

export function ContextDocRow({
  path,
  file,
  attached,
  onToggle,
  position,
  onMoveUp,
  onMoveDown,
  canMoveUp = false,
  canMoveDown = false,
  dragging = false,
  dropTarget = false,
  dragProps,
  previewing = false,
  onTogglePreview,
  previewBody,
}: ContextDocRowProps) {
  const t = useTranslations("context");
  const draggable = dragProps !== undefined;
  const missing = file === null;
  return (
    <li {...dragProps} draggable={draggable} style={s.row(attached, dragging, dropTarget)} data-path={path}>
      <div style={s.rowMain}>
        <span style={s.grip(draggable)} aria-hidden="true">
          <Icon.Menu size={13} />
        </span>
        {position != null && (
          <span className="tnum" style={s.position}>
            {position}
          </span>
        )}
        <div style={s.main}>
          <Checkbox checked={attached} onChange={onToggle} label={<span className="mono" style={s.path}>{path}</span>} />
        </div>
        {missing ? (
          <Badge color="var(--warn)">{t("picker.missing")}</Badge>
        ) : (
          file.root && <Badge color="var(--text-secondary)">{file.root}</Badge>
        )}
        {!missing && onTogglePreview && (
          <IconBtn
            icon={previewing ? "EyeOff" : "Eye"}
            size={26}
            label={previewing ? t("picker.hidePreview") : t("picker.preview")}
            onClick={onTogglePreview}
          />
        )}
        <div style={s.controls}>
          {onMoveUp && (
            <span style={s.arrow(canMoveUp)}>
              <IconBtn icon="ArrowUp" size={26} label={t("picker.moveUp", { path })} onClick={onMoveUp} />
            </span>
          )}
          {onMoveDown && (
            <span style={s.arrow(canMoveDown)}>
              <IconBtn icon="ArrowDown" size={26} label={t("picker.moveDown", { path })} onClick={onMoveDown} />
            </span>
          )}
        </div>
      </div>
      {previewing && <div style={s.previewWrap}>{previewBody}</div>}
    </li>
  );
}
