/* AddSkillDrawer — manual skill authoring (L02). The URL / community import
   tabs promised by `drawer.tabs.*` are later lessons; this ships the "from
   file" shape: paste a Markdown body, name it (or let the first heading name
   it), pick a type. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Drawer, FormField, SelectInput, TextInput, Textarea } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import { useCreateSkill } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { ApiError } from "@/lib/api";
import { SKILL_TYPE_VALUES } from "../../../../constants";
import { BODY_ROWS, DEFAULT_TYPE, DRAWER_WIDTH } from "./constants";
import { resolveSkillName } from "./helpers";
import { s } from "./styles";

export function AddSkillDrawer({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const toast = useToast();
  const create = useCreateSkill();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>(DEFAULT_TYPE);
  const [body, setBody] = React.useState("");

  const typeOptions = SKILL_TYPE_VALUES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }));
  const resolvedName = resolveSkillName(name, body);
  // A skill needs a body and a name; the name may come from the body's heading,
  // so "no name typed" is only a blocker when the body has no heading either.
  const canSubmit = body.trim().length > 0 && resolvedName.length > 0;

  const submit = async () => {
    const skill = await create.mutateAsync({
      name: resolvedName,
      description,
      type,
      source: "manual",
      body,
      enabled: true,
    });
    toast.success(t("file.success", { name: skill.name }));
    onClose();
    router.push(`/skills/${skill.id}?tab=config`);
  };

  return (
    <Drawer
      width={DRAWER_WIDTH}
      title={t("drawer.title")}
      subtitle={t("drawer.subtitle")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("file.cancel")}
          </Button>
          <Button
            kind="primary"
            icon="Plus"
            onClick={submit}
            disabled={!canSubmit || create.isPending}
          >
            {create.isPending ? t("file.importing") : t("file.import")}
          </Button>
        </div>
      }
    >
      {create.isError && (
        <div role="alert" style={s.error}>
          {t("drawer.importFailed")}
          {create.error instanceof ApiError ? ` — ${create.error.message}` : null}
        </div>
      )}

      <FormField label={t("file.nameLabel")} hint={t("file.nameHint")}>
        <TextInput value={name} onChange={setName} placeholder={t("file.namePlaceholder")} />
      </FormField>
      <FormField label={t("file.descriptionLabel")}>
        <TextInput
          value={description}
          onChange={setDescription}
          placeholder={t("file.descriptionPlaceholder")}
        />
      </FormField>
      <FormField label={t("file.typeLabel")}>
        <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={typeOptions} />
      </FormField>
      <FormField label={t("file.bodyLabel")} hint={t("file.bodyHint")} required>
        <Textarea
          value={body}
          onChange={setBody}
          rows={BODY_ROWS}
          mono
          placeholder={t("file.bodyPlaceholder")}
        />
      </FormField>
    </Drawer>
  );
}
