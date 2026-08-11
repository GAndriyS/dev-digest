/* diff-viewer — unified-diff viewer with optional inline GitHub comments.
   Public surface: the DiffViewer component + the contracts a caller needs to
   drive it — DiffCommentApi for inline comments, DiffFileMeta for the per-file
   overrides. A prop's type belongs on the barrel with the component: without
   it, callers redeclare the shape and a rename here typechecks green there. */
export { DiffViewer } from "./DiffViewer";
export type { DiffFileMeta, DiffLineAnnotation } from "./DiffViewer";
export type { DiffCommentApi } from "./comments";
