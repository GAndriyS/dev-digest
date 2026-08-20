/* DiscardChangesDialog — AC-7's confirmation. Shown only when the shell tries
   to switch the selected skill while ConfigTab (the sole registrant — see
   SkillDirtyGate) reports unsaved changes. Cancel drops the pending switch:
   the shell never navigates, so the current skill stays selected and the
   form is untouched — nothing to restore because nothing moved. Discard
   fires the switch that was blocked. */
"use client";

import { useTranslations } from "next-intl";
import { Button, Modal } from "@devdigest/ui";
import { MODAL_WIDTH } from "./constants";
import { s } from "./styles";

export function DiscardChangesDialog({
  onDiscard,
  onCancel,
}: {
  onDiscard: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("skills");

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("unsavedDialog.title")}
      subtitle={t("unsavedDialog.body")}
      onClose={onCancel}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onCancel}>
            {t("unsavedDialog.cancel")}
          </Button>
          <Button kind="danger" icon="AlertTriangle" onClick={onDiscard}>
            {t("unsavedDialog.discard")}
          </Button>
        </div>
      }
    />
  );
}
