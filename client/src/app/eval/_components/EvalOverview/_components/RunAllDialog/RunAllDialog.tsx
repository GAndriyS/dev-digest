/* RunAllDialog — AC-46/AC-48's confirmation over the vendored Modal
   (`client/src/vendor/ui/kit/Modal.tsx`). Names the agent count and the
   total case count FROM PROPS in the dialog body, before anything runs —
   the counts are already on the wire (`agents.length`, `Σ cases_total`), so
   opening this dialog makes no request of its own.

   Dismissal (Cancel, overlay click, Escape) calls `onCancel` only — never
   `onConfirm` — so no run starts and no provider is called (AC-48). The
   vendored Modal closes on overlay click and its own `X` via `onClose`, but
   has NO Escape handler, so this component adds its own `keydown` listener
   (precedent: `AddRepoView.tsx`, `InlineComposer.tsx`) rather than editing
   the vendored file (do-not-touch: `src/vendor/ui`). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal } from "@devdigest/ui";
import { MODAL_WIDTH } from "./constants";
import { s } from "./styles";

export function RunAllDialog({
  agentsCount,
  casesTotal,
  onConfirm,
  onCancel,
}: {
  agentsCount: number;
  casesTotal: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("eval");

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("runAllAgents.dialogTitle")}
      subtitle={t("runAllAgents.dialogBody", { agents: agentsCount, cases: casesTotal })}
      onClose={onCancel}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onCancel}>
            {t("runAllAgents.cancel")}
          </Button>
          <Button kind="primary" icon="Play" onClick={onConfirm}>
            {t("runAllAgents.confirm")}
          </Button>
        </div>
      }
    />
  );
}
