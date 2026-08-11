/** Pure helpers for SmartDiffViewer — turn the SmartDiff response (paths only,
    no patch text) into the props DiffViewer/FileCard already understand. */
import type { PrFile, SmartDiffGroup, SmartDiffRole } from "@devdigest/shared";
import type { DiffFileMeta } from "@/components/diff-viewer";
import { DEFAULT_OPEN_BY_ROLE } from "./constants";

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
    alone) plus that file's finding-line numbers for the clickable badge. */
export function buildFileMeta(groups: SmartDiffGroup[]): Record<string, FileMetaEntry> {
  const meta: Record<string, FileMetaEntry> = {};
  for (const g of groups) {
    const openOverride = DEFAULT_OPEN_BY_ROLE[g.role];
    for (const f of g.files) {
      meta[f.path] = {
        defaultOpen: openOverride === null ? undefined : openOverride,
        findingLines: f.finding_lines,
      };
    }
  }
  return meta;
}

/** Total finding-line count across a group's files, for the group header. */
export function groupFindingLineCount(group: SmartDiffGroup): number {
  return group.files.reduce((n, f) => n + f.finding_lines.length, 0);
}
