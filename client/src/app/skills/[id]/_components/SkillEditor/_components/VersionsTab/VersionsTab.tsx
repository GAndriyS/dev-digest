/* VersionsTab — immutable body history: what changed, when, and how to get an
   old body back. Restoring appends a NEW version rather than rewinding, so the
   history stays append-only and an accidental restore is itself undoable. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, SelectInput, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useRestoreSkillVersion, useSkillVersion, useSkillVersions } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { DIFF_COLORS } from "./constants";
import { countChanges, diffLines, formatVersionDate } from "./helpers";
import { s } from "./styles";

export function VersionsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const { data: versions, isLoading, isError, refetch } = useSkillVersions(skill.id);
  const restore = useRestoreSkillVersion();

  const [from, setFrom] = React.useState<number | null>(null);
  const [to, setTo] = React.useState<number | null>(null);

  // Default the comparison to "the last change": the two newest versions. Only
  // seeds empty selections, so a user's pick survives a history refetch.
  const list = React.useMemo(
    () => [...(versions ?? [])].sort((a, b) => b.version - a.version),
    [versions],
  );
  React.useEffect(() => {
    if (list.length < 2 || from != null || to != null) return;
    setFrom(list[1]?.version ?? null);
    setTo(list[0]?.version ?? null);
  }, [list, from, to]);

  const fromBody = useSkillVersion(skill.id, from);
  const toBody = useSkillVersion(skill.id, to);

  if (isError) return <ErrorState body={t("versions.loadError")} onRetry={() => refetch()} />;
  if (isLoading) return <Skeleton height={200} />;

  const doRestore = (version: number) => {
    if (!window.confirm(t("versions.restoreConfirm", { version }))) return;
    restore.mutate(
      { id: skill.id, version },
      {
        onSuccess: (data) =>
          toast.success(t("versions.restoreToast", { version, current: data.version })),
      },
    );
  };

  const options = list.map((v) => ({ value: String(v.version), label: `v${v.version}` }));
  const beforeText = fromBody.data?.body;
  const afterText = toBody.data?.body;
  const bothLoaded = beforeText != null && afterText != null;
  const rows = bothLoaded ? diffLines(beforeText, afterText) : [];
  const counts = countChanges(rows);
  const identical = bothLoaded && counts.added === 0 && counts.removed === 0;

  return (
    <div style={s.wrap}>
      <div>
        <h2 style={s.h2}>{t("versions.title")}</h2>
        <p style={s.hint}>{t("versions.subtitle")}</p>
      </div>

      <div style={s.section}>
        {list.length === 0 ? (
          <EmptyState
            icon="History"
            title={t("versions.empty.title")}
            body={t("versions.empty.body")}
          />
        ) : (
          list.map((v) => (
            <div key={v.version} style={s.row}>
              <Badge color="var(--text-secondary)" mono>
                {t("preview.version", { version: v.version })}
              </Badge>
              <span style={s.rowDate}>{formatVersionDate(v.created_at)}</span>
              <span className="tnum" style={s.rowChars}>
                {t("versions.chars", { chars: v.body_chars })}
              </span>
              {v.version === skill.version ? (
                <Badge color="var(--ok)">{t("versions.current")}</Badge>
              ) : (
                <Button
                  kind="secondary"
                  size="sm"
                  icon="History"
                  onClick={() => doRestore(v.version)}
                  disabled={restore.isPending}
                >
                  {restore.isPending ? t("versions.restoring") : t("versions.restore")}
                </Button>
              )}
            </div>
          ))
        )}
      </div>

      <div style={s.section}>
        <h3 style={s.h3}>{t("versions.compareTitle")}</h3>
        {list.length < 2 ? (
          <div style={s.muted}>{t("versions.pickTwo")}</div>
        ) : (
          <>
            <div style={s.pickers}>
              <div style={s.picker}>
                <label style={s.pickerLabel}>{t("versions.from")}</label>
                <SelectInput
                  value={from == null ? "" : String(from)}
                  onChange={(v) => setFrom(Number(v))}
                  options={options}
                />
              </div>
              <div style={s.picker}>
                <label style={s.pickerLabel}>{t("versions.to")}</label>
                <SelectInput
                  value={to == null ? "" : String(to)}
                  onChange={(v) => setTo(Number(v))}
                  options={options}
                />
              </div>
            </div>

            {from === to && <div style={s.muted}>{t("versions.pickTwo")}</div>}
            {from !== to && !bothLoaded && <div style={s.muted}>{t("versions.loadingDiff")}</div>}
            {from !== to && identical && <div style={s.muted}>{t("versions.identical")}</div>}
            {from !== to && bothLoaded && !identical && (
              <>
                <div className="tnum" style={s.summary}>
                  {t("versions.diffSummary", { added: counts.added, removed: counts.removed })}
                </div>
                <div className="mono" style={s.diff}>
                  {rows.map((row, i) => (
                    <div key={i} style={s.diffRow(row.kind)}>
                      <span className="tnum" style={s.gutter}>
                        {row.leftNo ?? ""} {row.rightNo ?? ""}
                      </span>
                      <span style={s.sign(row.kind)}>{DIFF_COLORS[row.kind].sign}</span>
                      <span>{row.text}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
