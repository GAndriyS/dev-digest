/* ImportSkillDrawer — upload → preview → confirm (L02).
   Picking a file only ever asks the server what it WOULD extract
   (`POST /skills/import/preview`, which writes nothing); the skill is created
   by an ordinary `POST /skills` when the user presses Save. Nothing here writes
   on selection, so Cancel really does discard.
   The skipped-entry list is part of the product promise, not decoration: an
   archive's non-Markdown members are named on screen precisely so the user can
   see they were never read or executed. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Drawer,
  FormField,
  Markdown,
  SelectInput,
  TextInput,
} from "@devdigest/ui";
import type { SkillImportPreview, SkillType } from "@devdigest/shared";
import { useCreateSkill, useImportSkillPreview } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { ApiError } from "@/lib/api";
import { SKILL_TYPE_VALUES } from "../../../../constants";
import { DRAWER_WIDTH, FILE_ACCEPT } from "./constants";
import { isSupportedSkillFile, readFileAsBase64 } from "./helpers";
import { s } from "./styles";

export function ImportSkillDrawer({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const toast = useToast();
  const preview = useImportSkillPreview();
  const create = useCreateSkill();

  // The visible trigger is a Button; the native input is hidden behind this ref.
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [filename, setFilename] = React.useState("");
  const [reading, setReading] = React.useState(false);
  const [readError, setReadError] = React.useState<string | null>(null);
  // The confirmed-so-far draft. Held separately from `preview.data` because the
  // user may correct the extracted metadata before saving, and because clearing
  // it is how "pick another file" resets the confirmation.
  const [extracted, setExtracted] = React.useState<SkillImportPreview | null>(null);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("custom");

  const typeOptions = SKILL_TYPE_VALUES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }));

  const onPick = async (file: File | undefined) => {
    setExtracted(null);
    setReadError(null);
    if (!file) return;
    setFilename(file.name);
    if (!isSupportedSkillFile(file.name)) {
      setReadError(t("import.unsupported"));
      return;
    }
    setReading(true);
    let content_base64: string;
    try {
      content_base64 = await readFileAsBase64(file);
    } catch {
      setReadError(t("import.readFailed"));
      return;
    } finally {
      setReading(false);
    }
    // mutate, not mutateAsync: a 404 while the endpoint is still landing must
    // surface as the drawer's error state, not an unhandled rejection.
    preview.mutate(
      { filename: file.name, content_base64 },
      {
        onSuccess: (data) => {
          setExtracted(data);
          setName(data.name);
          setDescription(data.description);
          setType(data.type);
        },
      },
    );
  };

  const save = () => {
    if (!extracted) return;
    create.mutate(
      // 'imported_url' rather than 'manual': nobody here authored this text, and
      // that is the distinction `source` exists to record — it is what puts the
      // "needs vetting" badge on the card and the untrusted notice on the
      // preview. SkillSource has no `imported_file` member, and inventing one is
      // a contract change, not a UI decision.
      // …and `enabled: false` follows from it: an unvetted body must not reach a
      // review prompt just because a file was picked. The card's toggle is one
      // click away, which makes enabling a decision rather than a default.
      { name, description, type, source: "imported_url", body: extracted.body, enabled: false },
      {
        onSuccess: (skill) => {
          toast.success(t("import.success", { name: skill.name }));
          onClose();
          router.push(`/skills/${skill.id}?tab=config`);
        },
      },
    );
  };

  const busy = reading || preview.isPending;
  const failure =
    readError ??
    (preview.isError
      ? `${t("import.previewFailed")}${
          preview.error instanceof ApiError ? ` — ${preview.error.message}` : ""
        }`
      : null) ??
    (create.isError
      ? `${t("drawer.importFailed")}${
          create.error instanceof ApiError ? ` — ${create.error.message}` : ""
        }`
      : null);

  return (
    <Drawer
      width={DRAWER_WIDTH}
      title={t("import.title")}
      subtitle={t("import.subtitle")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("import.cancel")}
          </Button>
          <Button
            kind="primary"
            icon="Check"
            onClick={save}
            disabled={!extracted || !name.trim() || create.isPending}
          >
            {create.isPending ? t("import.saving") : t("import.save")}
          </Button>
        </div>
      }
    >
      {failure && (
        <div role="alert" style={s.error}>
          {failure}
        </div>
      )}

      <FormField label={t("import.fileLabel")} hint={t("import.fileHint")} required>
        <div style={s.filePicker}>
          <input
            ref={fileRef}
            type="file"
            accept={FILE_ACCEPT}
            aria-label={t("import.fileLabel")}
            // Out of the tab order: the Button beside it is the keyboard
            // affordance, and a clipped input would otherwise be an invisible
            // stop with no focus ring.
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Clear the value so picking the SAME file fires change again.
              // Without this, the natural retry after a read or preview error
              // is a silent no-op.
              e.target.value = "";
              void onPick(file);
            }}
            style={s.fileInput}
          />
          <Button kind="secondary" icon="Upload" onClick={() => fileRef.current?.click()}>
            {t("import.choose")}
          </Button>
          <span style={filename ? s.fileName : s.fileNamePlaceholder}>
            {filename || t("import.noFile")}
          </span>
        </div>
      </FormField>

      {busy && (
        <p style={s.status}>{reading ? t("import.reading", { filename }) : t("import.extracting")}</p>
      )}

      {extracted && (
        <div style={s.result}>
          <div style={s.resultHeader}>
            <h3 style={s.h3}>{t("import.previewTitle")}</h3>
            <Badge color="var(--text-muted)" mono>
              {filename}
            </Badge>
          </div>
          <p style={s.unsavedNote}>{t("import.previewHint")}</p>

          <FormField label={t("file.nameLabel")} required>
            <TextInput value={name} onChange={setName} placeholder={t("file.namePlaceholder")} />
          </FormField>
          <FormField label={t("file.descriptionLabel")} hint={t("descriptionCaption")}>
            <TextInput
              value={description}
              onChange={setDescription}
              placeholder={t("file.descriptionPlaceholder")}
            />
          </FormField>
          <FormField label={t("file.typeLabel")}>
            <SelectInput
              value={type}
              onChange={(v) => setType(v as SkillType)}
              options={typeOptions}
            />
          </FormField>

          <h4 style={s.h4}>{t("import.bodyTitle")}</h4>
          <p style={s.hint}>
            {t("import.sourceFiles", { count: extracted.source_files.length })}
          </p>
          <div style={s.frame}>
            {extracted.body.trim() ? (
              <Markdown>{extracted.body}</Markdown>
            ) : (
              <div style={s.empty}>{t("import.emptyBody")}</div>
            )}
          </div>

          {extracted.skipped_files.length > 0 && (
            <div style={s.skipped}>
              <h4 style={s.h4}>
                {t("import.skippedTitle", { count: extracted.skipped_files.length })}
              </h4>
              <ul style={s.skippedList}>
                {extracted.skipped_files.map((file) => (
                  <li key={file} className="mono" style={s.skippedItem}>
                    {file}
                  </li>
                ))}
              </ul>
              <p style={s.skippedNote}>{t("import.skippedNote")}</p>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
