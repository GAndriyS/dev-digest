/** Pure helpers for SmartDiffViewer — turn the SmartDiff response (paths only,
    no patch text) into the props DiffViewer/FileCard already understand. */
import type { FindingRecord, PrFile, SmartDiffGroup, SmartDiffRole } from "@devdigest/shared";
import type { Severity } from "@/lib/types";
import type { DiffFileMeta, DiffLineAnnotation } from "@/components/diff-viewer";
import { DEFAULT_OPEN_BY_ROLE } from "./constants";

/** CRITICAL → WARNING → SUGGESTION, for both the sort within a line and the
    sort within a file's annotation list. */
const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 0,
  WARNING: 1,
  SUGGESTION: 2,
};

/** The shared viewer's own per-file override type, imported from its barrel
    rather than restated here: both fields are optional, so a structural copy
    stays assignable even after a rename and the badges would go quietly
    missing. */
export type FileMetaEntry = DiffFileMeta;

export interface RoleFileGroup {
  role: SmartDiffRole;
  /** The PR's real files (patch text + stats) for this group's paths, in the
      group's server order. A path the group names that the PR detail doesn't
      have (stale ranking) is silently dropped here — `ungroupedFiles` below
      is the mirror case and is what guarantees no file vanishes overall. */
  files: PrFile[];
}

/** Resolves each group's paths against the PR's actual files — SmartDiffFile
    carries no patch text, only `path`/`additions`/`deletions`/`finding_lines`,
    so the real `PrFile` (with `patch`) is what FileCard needs to render. */
export function groupFiles(groups: SmartDiffGroup[], files: PrFile[]): RoleFileGroup[] {
  const byPath = new Map(files.map((f) => [f.path, f] as const));
  return groups.map((g) => ({
    role: g.role,
    files: g.files.map((sf) => byPath.get(sf.path)).filter((f): f is PrFile => f != null),
  }));
}

/** Every `PrFile` none of the response's groups mention — appended as a tail
    so ranking gaps never drop a file from the tab silently. Empty in the
    common case where the response accounts for every file. */
export function ungroupedFiles(groups: SmartDiffGroup[], files: PrFile[]): PrFile[] {
  const grouped = new Set(groups.flatMap((g) => g.files.map((f) => f.path)));
  return files.filter((f) => !grouped.has(f.path));
}

/** Builds the `fileMeta` prop DiffViewer forwards to each FileCard: the
    role's `defaultOpen` override (`null` = leave FileCard's own heuristic
    alone) plus that file's line annotations for the clickable badge/chips. */
export function buildFileMeta(
  groups: SmartDiffGroup[],
  annotationsByPath: Record<string, DiffLineAnnotation[]>,
): Record<string, FileMetaEntry> {
  const meta: Record<string, FileMetaEntry> = {};
  for (const g of groups) {
    const openOverride = DEFAULT_OPEN_BY_ROLE[g.role];
    for (const f of g.files) {
      meta[f.path] = {
        defaultOpen: openOverride === null ? undefined : openOverride,
        annotations: annotationsByPath[f.path],
      };
    }
  }
  return meta;
}

/** Builds `fileMeta` for exactly one target file — `defaultOpen: true`, no
    annotations. SPEC-04 (`?file=` navigation from PrBriefCard's Review Focus,
    AC-34) needs the SAME `defaultOpen` lever this module already owns for
    Smart order (`buildFileMeta` above), but Amendment A3 forbids a second
    writer of `defaultOpen` for the same path. Rather than reach into
    `SmartDiffViewer`'s own grouped render to inject a target there, DiffTab
    calls this directly and renders `DiffViewer` on its own (R3) — the two
    assembly points never run against the same file in the same render, so
    there is still exactly one owner, just two mutually-exclusive callers. */
export function targetFileMeta(path: string): Record<string, FileMetaEntry> {
  return { [path]: { defaultOpen: true } };
}

/** Client-side join of the PR's findings onto its files, replacing the
    server's frozen (and now-dead) `finding_lines`: the contract carries
    neither `id` nor `severity`, both of which the annotation needs, and
    `usePrReviews` is already loaded for the Agent-runs tab's own counter —
    this reuses it rather than adding a request. Dismissed findings are
    dropped; `kind === 'review'` is deliberately NOT filtered, for parity
    with that counter. A finding whose `file` doesn't match any of `files`
    (stale/renamed path) is silently dropped, same as `groupFiles` above. */
export function buildAnnotations(
  files: PrFile[],
  findings: FindingRecord[],
): Record<string, DiffLineAnnotation[]> {
  const knownPaths = new Set(files.map((f) => f.path));
  const byPath: Record<string, DiffLineAnnotation[]> = {};
  for (const f of findings) {
    if (f.dismissed_at != null) continue;
    if (!knownPaths.has(f.file)) continue;
    (byPath[f.file] ??= []).push({ findingId: f.id, line: f.start_line, severity: f.severity });
  }
  for (const path of Object.keys(byPath)) {
    byPath[path]!.sort((a, b) => a.line - b.line || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  }
  return byPath;
}
