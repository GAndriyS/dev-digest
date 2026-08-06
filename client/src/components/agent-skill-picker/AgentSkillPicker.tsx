/* AgentSkillPicker — attach skills to an agent and order them.

   Shared (src/components/) rather than route-local on purpose: both the Agents
   editor and the Skills Lab mount it, and `src/app/skills/**` may not import
   from `src/app/agents/**` (dependency-cruiser: no-cross-route-internals).

   Order is the product feature, not decoration — the linked skills are rendered
   into the review prompt in exactly this sequence, so reordering is a real edit
   and is persisted as such: the whole set is PUT back via `{skill_ids}`.

   Reorder must feel instant, so the list is optimistic: `draft` takes over the
   moment the user acts, and is dropped again if the write fails (the server
   list is then the truth). Both affordances are supported — HTML5 drag for the
   mouse, ArrowUp/ArrowDown buttons for the keyboard and for touch, which
   `draggable` does not serve. There is no dnd library in this app and this
   feature does not justify adding one. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState, SectionLabel, Skeleton, TextInput } from "@devdigest/ui";
import { useAgentSkills, useSetAgentSkills, useSkills } from "../../lib/hooks/skills";
import { SkillRow } from "./SkillRow";
import { matchesFilter, moveItem, orderedSkillIds, partitionSkills } from "./helpers";
import { s } from "./styles";

export function AgentSkillPicker({ agentId }: { agentId: string }) {
  const t = useTranslations("agents");
  const skillsQuery = useSkills();
  const linksQuery = useAgentSkills(agentId);
  const setSkills = useSetAgentSkills();

  const [query, setQuery] = React.useState("");
  /** Optimistic order; `null` means "the server list is the truth". */
  const [draft, setDraft] = React.useState<string[] | null>(null);
  const [dragFrom, setDragFrom] = React.useState<number | null>(null);
  const [dragOver, setDragOver] = React.useState<number | null>(null);

  // Switching agents inside the editor keeps this component mounted; the draft
  // belongs to the agent it was made for, so it must not survive the change.
  React.useEffect(() => {
    setDraft(null);
  }, [agentId]);

  const serverIds = React.useMemo(() => orderedSkillIds(linksQuery.data), [linksQuery.data]);
  const linkedIds = draft ?? serverIds;

  const commit = (next: string[]) => {
    setDraft(next);
    setSkills.mutate(
      { agentId, skill_ids: next },
      // Roll back to the server list rather than to the previous draft: after a
      // failed write the server is the only order we can still vouch for.
      { onError: () => setDraft(null) },
    );
  };

  const toggle = (skillId: string) =>
    commit(
      linkedIds.includes(skillId)
        ? linkedIds.filter((id) => id !== skillId)
        : // A newly attached skill goes last — appending never silently
          // reshuffles the prompt the user already arranged.
          [...linkedIds, skillId],
    );

  const move = (from: number, to: number) => {
    if (to < 0 || to >= linkedIds.length) return;
    commit(moveItem(linkedIds, from, to));
  };

  const endDrag = () => {
    setDragFrom(null);
    setDragOver(null);
  };

  const dragPropsFor = (index: number): React.HTMLAttributes<HTMLLIElement> => ({
    onDragStart: (e) => {
      setDragFrom(index);
      e.dataTransfer.effectAllowed = "move";
      // Firefox ignores a drag that carries no payload.
      e.dataTransfer.setData("text/plain", String(index));
    },
    onDragOver: (e) => {
      if (dragFrom === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDragOver(index);
    },
    onDrop: (e) => {
      e.preventDefault();
      if (dragFrom !== null && dragFrom !== index) move(dragFrom, index);
      endDrag();
    },
    onDragEnd: endDrag,
  });

  if (skillsQuery.isLoading || linksQuery.isLoading) {
    return (
      <div style={s.loading}>
        <Skeleton height={20} width={200} />
        <Skeleton height={44} />
        <Skeleton height={44} />
        <Skeleton height={44} />
      </div>
    );
  }

  if (skillsQuery.isError || linksQuery.isError) {
    return <EmptyState icon="AlertTriangle" title={t("skills.loadError")} />;
  }

  const skills = skillsQuery.data ?? [];
  if (skills.length === 0) {
    return <EmptyState icon="Sparkles" title={t("skills.emptyTitle")} body={t("skills.emptyBody")} />;
  }

  const { linked, available } = partitionSkills(skills, linkedIds);
  const shownLinked = linked.filter((sk) => matchesFilter(sk, query));
  const shownAvailable = available.filter((sk) => matchesFilter(sk, query));
  const noMatches = shownLinked.length === 0 && shownAvailable.length === 0;

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("skills.title")}</h2>
        <span style={s.count}>
          {t("skills.enabledCount", { linked: linked.length, total: skills.length })}
        </span>
      </div>
      <p style={s.hint}>{t("skills.orderHint")}</p>
      <TextInput value={query} onChange={setQuery} placeholder={t("skills.filterPlaceholder")} />

      {noMatches && <EmptyState icon="Search" title={t("skills.noMatches", { query })} />}

      {shownLinked.length > 0 && (
        <div style={s.section}>
          <SectionLabel icon="Sparkles">{t("skills.linkedHeading")}</SectionLabel>
          <ul style={s.list}>
            {shownLinked.map((sk) => {
              // Position and moves are relative to the FULL linked order, never
              // to the filtered view — a filter must not renumber the prompt.
              const index = linkedIds.indexOf(sk.id);
              return (
                <SkillRow
                  key={sk.id}
                  skill={sk}
                  linked
                  position={index + 1}
                  onToggle={() => toggle(sk.id)}
                  onMoveUp={() => move(index, index - 1)}
                  onMoveDown={() => move(index, index + 1)}
                  canMoveUp={index > 0}
                  canMoveDown={index < linkedIds.length - 1}
                  dragging={dragFrom === index}
                  dropTarget={dragOver === index && dragFrom !== null && dragFrom !== index}
                  dragProps={dragPropsFor(index)}
                />
              );
            })}
          </ul>
        </div>
      )}

      {shownAvailable.length > 0 && (
        <div style={s.section}>
          <SectionLabel icon="Layers">{t("skills.availableHeading")}</SectionLabel>
          <ul style={s.list}>
            {shownAvailable.map((sk) => (
              <SkillRow key={sk.id} skill={sk} linked={false} onToggle={() => toggle(sk.id)} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
