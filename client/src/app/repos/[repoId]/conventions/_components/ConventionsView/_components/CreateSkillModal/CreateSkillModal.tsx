/* CreateSkillModal — merge the accepted conventions into ONE skill.

   Everything is pre-filled and editable: the extractor proposes, the user
   ships. Saving is an ordinary `POST /skills` with `source: 'extracted'` and
   the evidence paths attached — the same create endpoint the Skills Lab uses,
   so this flow adds no server surface of its own. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Button,
  FormField,
  Icon,
  Modal,
  SelectInput,
  Textarea,
  TextInput,
  Toggle,
} from "@devdigest/ui";
import { SkillType, type ConventionCandidate, type SkillType as SkillTypeT } from "@devdigest/shared";
import { useCreateSkill } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { ApiError } from "@/lib/api";
import { buildConventionsSkill, defaultSkillName } from "../../helpers";
import { BODY_ROWS, CREATE_MODAL_WIDTH } from "./constants";
import { s } from "./styles";

export function CreateSkillModal({
  accepted,
  repoFullName,
  onClose,
}: {
  accepted: ConventionCandidate[];
  repoFullName: string;
  onClose: () => void;
}) {
  const t = useTranslations("conventions");
  const tSkills = useTranslations("skills");
  const router = useRouter();
  const toast = useToast();
  const create = useCreateSkill();

  const [name, setName] = React.useState(() => defaultSkillName(repoFullName));
  const [description, setDescription] = React.useState(() =>
    t("modal.descriptionDefault", { count: accepted.length, repo: repoFullName }),
  );
  const [type, setType] = React.useState<SkillTypeT>("convention");
  const [enabled, setEnabled] = React.useState(true);
  const [body, setBody] = React.useState(() => buildConventionsSkill(repoFullName, accepted));

  // Derived from the contract rather than the Skills route's own constants:
  // `src/app/skills/**` is another route tree and may not be imported here.
  const typeOptions = SkillType.options.map((v) => ({
    value: v,
    label: tSkills(`listItem.type.${v}`),
  }));

  const save = () => {
    create.mutate(
      {
        name: name.trim(),
        description,
        type,
        source: "extracted",
        body,
        enabled,
        evidence_files: accepted.map((c) => c.evidence_path).filter((p) => p.length > 0),
      },
      {
        onSuccess: (skill) => {
          toast.success(t("modal.success", { name: skill.name, count: accepted.length }));
          onClose();
          router.push(`/skills/${skill.id}?tab=config`);
        },
      },
    );
  };

  const failure = create.isError
    ? `${t("modal.failed")}${create.error instanceof ApiError ? ` — ${create.error.message}` : ""}`
    : null;

  return (
    <Modal
      width={CREATE_MODAL_WIDTH}
      title={t("modal.title")}
      subtitle={defaultSkillName(repoFullName)}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("modal.cancel")}
          </Button>
          <Button
            kind="primary"
            icon="Sparkles"
            onClick={save}
            disabled={!name.trim() || !body.trim() || create.isPending}
          >
            {create.isPending ? t("modal.saving") : t("modal.save")}
          </Button>
        </div>
      }
    >
      {failure && (
        <div role="alert" style={s.error}>
          {failure}
        </div>
      )}

      <div style={s.banner}>
        <Icon.Sparkles size={14} style={s.bannerIcon} />
        <span>{t("modal.mergedFrom", { count: accepted.length, repo: repoFullName })}</span>
      </div>

      <FormField label={t("modal.nameLabel")} required>
        <TextInput value={name} onChange={setName} mono />
      </FormField>

      <FormField label={t("modal.descriptionLabel")}>
        <TextInput value={description} onChange={setDescription} />
      </FormField>

      <div style={s.row}>
        <div style={s.col}>
          <FormField label={t("modal.typeLabel")}>
            <SelectInput value={type} onChange={(v) => setType(v as SkillTypeT)} options={typeOptions} />
          </FormField>
        </div>
        <div style={s.col}>
          <FormField label={t("modal.enabledLabel")} hint={t("modal.enabledHint")}>
            <div style={s.toggleRow}>
              <Toggle on={enabled} onChange={setEnabled} />
            </div>
          </FormField>
        </div>
      </div>

      <FormField label={t("modal.bodyLabel")} required>
        <Textarea value={body} onChange={setBody} rows={BODY_ROWS} mono />
      </FormField>
    </Modal>
  );
}
