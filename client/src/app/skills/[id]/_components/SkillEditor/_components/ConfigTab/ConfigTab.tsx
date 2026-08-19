/* ConfigTab — the skill's metadata and its Markdown body. Saving is explicit:
   a body edit mints a new immutable version server-side (see `preview.bodyHint`),
   so it must not happen on every keystroke. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, FormField, SelectInput, TextInput, Textarea, Toggle } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useUpdateSkill } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { SKILL_TYPE_VALUES } from "../../../../../constants";
import { useRegisterSkillDirty } from "../../../../../_components/SkillDirtyGate";
import { BODY_ROWS } from "./constants";
import { estimateBodyTokens } from "./helpers";
import { s } from "./styles";

export function ConfigTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const update = useUpdateSkill();

  const [name, setName] = React.useState(skill.name);
  const [description, setDescription] = React.useState(skill.description);
  const [type, setType] = React.useState<SkillType>(skill.type);
  const [enabled, setEnabled] = React.useState(skill.enabled);
  const [body, setBody] = React.useState(skill.body);

  // The `skill` prop can change for two different reasons, and they need
  // opposite handling:
  //
  // 1. The route swapped to a DIFFERENT skill (`skill.id` changed). AC-7's
  //    gate has already made sure that only happens with nothing unsaved (the
  //    shell blocks the navigation and asks to discard first) — so this is an
  //    unconditional reseed, same as before: every field takes the new
  //    skill's value, full stop.
  // 2. The SAME skill's record changed under an untouched form (`skill.id` is
  //    the same, `skill` itself is a new object). The left-column card and
  //    this form are on screen together, so flipping a card's `enabled`
  //    toggle runs its own mutation, which primes ["skill", id] with a fresh
  //    object right under this form's feet (useUpdateSkill's onSuccess,
  //    hooks/skills.ts) — with no user edit anywhere. Reseeding on
  //    `skill.id` alone treated this exactly like case 1 never happened at
  //    all: the stale field just sat there, `dirty` read true with nothing
  //    typed, and Save would PUT that STALE value back, silently reverting
  //    the change just made elsewhere. Here, each field only follows the
  //    update if it still equals what the PREVIOUS `skill` held for it (i.e.
  //    nothing was typed into it) — so an untouched field tracks the server
  //    and stays out of `dirty`, while a field the user HAS edited keeps
  //    exactly what they typed, whatever the server value goes on to become.
  const lastSeenRef = React.useRef(skill);
  React.useEffect(() => {
    const prev = lastSeenRef.current;
    const idChanged = prev.id !== skill.id;

    setName((current) => (idChanged || current === prev.name ? skill.name : current));
    setDescription((current) => (idChanged || current === prev.description ? skill.description : current));
    setType((current) => (idChanged || current === prev.type ? skill.type : current));
    setEnabled((current) => (idChanged || current === prev.enabled ? skill.enabled : current));
    setBody((current) => (idChanged || current === prev.body ? skill.body : current));

    lastSeenRef.current = skill;
  }, [skill]);

  const dirty =
    name !== skill.name ||
    description !== skill.description ||
    type !== skill.type ||
    enabled !== skill.enabled ||
    body !== skill.body;

  // AC-7: the shell (several route segments up, past SkillEditor and
  // SkillDetailView) reads this to decide whether switching skill needs
  // confirmation. ConfigTab stays mounted across a tab switch of the same
  // skill (SkillEditor.tsx hides, never unmounts, the Config pane), so this
  // registration — and the form state above it — survives a trip to another
  // tab and back.
  useRegisterSkillDirty(dirty);

  const typeOptions = SKILL_TYPE_VALUES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }));
  const bodyTokens = estimateBodyTokens(body);

  const save = () =>
    update.mutate(
      { id: skill.id, patch: { name, description, type, enabled, body } },
      { onSuccess: (data) => toast.success(t("config.savedToast", { version: data.version })) },
    );

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("config.title")}</h2>
        <Badge color="var(--text-secondary)" mono>
          {t("preview.version", { version: skill.version })}
        </Badge>
        <label style={s.enabledLabel}>
          {enabled ? t("preview.enabled") : t("preview.disabled")}
          <Toggle on={enabled} onChange={setEnabled} size={16} />
        </label>
      </div>

      <FormField label={t("config.nameLabel")} required>
        <TextInput value={name} onChange={setName} />
      </FormField>
      {/* The caption is not decoration: the description is the skill's
          interface — an agent reads it to decide whether to apply the skill —
          so the UI has to say that where it is written. */}
      <FormField label={t("config.descriptionLabel")} hint={t("descriptionCaption")}>
        <TextInput
          value={description}
          onChange={setDescription}
          placeholder={t("config.descriptionPlaceholder")}
        />
      </FormField>
      <FormField label={t("config.typeLabel")}>
        <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={typeOptions} />
      </FormField>
      <FormField
        label={t("preview.bodyLabel")}
        hint={t("preview.bodyHint")}
        required
        right={
          <div style={s.bodyMeta}>
            {/* AC-19: deterministic, client-only estimate of the text
                currently in the field — no request, no model call. */}
            <span style={s.tokenCount}>{t("config.bodyTokens", { count: bodyTokens })}</span>
            {dirty && <span style={s.dirtyNote}>{t("config.unsaved")}</span>}
          </div>
        }
      >
        <Textarea value={body} onChange={setBody} rows={BODY_ROWS} mono />
      </FormField>

      <div style={s.actions}>
        <Button
          kind="primary"
          icon="Check"
          onClick={save}
          disabled={!dirty || update.isPending || !name.trim() || !body.trim()}
        >
          {update.isPending ? t("config.saving") : t("preview.save")}
        </Button>
      </div>
    </div>
  );
}
