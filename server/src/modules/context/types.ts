import type { ContextListing, ContextPaths, SpecFile } from '@devdigest/shared';

/** One attached-but-unpacked document, with why — feeds the run's Live Log (Observability NFR). */
export interface SkippedContextDoc {
  path: string;
  reason: string;
}

/** The result of resolving one run's Project Context attachments. */
export interface ResolvedContextDocs {
  /**
   * Formatted chunks (`### <path>\n\n<content>`), in the order they were
   * packed — pass straight into reviewer-core's `ReviewInput.specs`.
   */
  specs: string[];
  /** Paths of the chunks above, same order — becomes `RunTrace.specs_read` verbatim. */
  specsRead: string[];
  /** Every attached path that did NOT make it into the prompt, with why. */
  skipped: SkippedContextDoc[];
}

/**
 * The Project Context facade — the module's public surface for other
 * modules. `modules/reviews/run-executor.ts` reaches this through
 * `container.projectContext` rather than importing `service.ts` directly,
 * because `no-cross-module-internals` forbids the latter. Mirrors the
 * `container.repoIntel` precedent (`modules/repo-intel/types.ts`).
 */
export interface ProjectContext {
  /** `GET /repos/:id/context`. Throws `NotFoundError` (repo) / a "not cloned" `AppError`. */
  listContext(workspaceId: string, repoId: string): Promise<ContextListing>;

  /** `GET /repos/:id/context/doc?path=`. Throws `NotFoundError` when the repo or the document can't be read. */
  readDoc(workspaceId: string, repoId: string, path: string): Promise<SpecFile>;

  /** `GET /agents/:id/context`. `undefined` ⇒ agent not in this workspace (route → 404). */
  agentDocs(workspaceId: string, agentId: string): Promise<ContextPaths | undefined>;

  /** `POST /agents/:id/context` — replaces the whole ordered set. */
  setAgentDocs(
    workspaceId: string,
    agentId: string,
    paths: string[],
  ): Promise<ContextPaths | undefined>;

  /** `GET /skills/:id/context`. `undefined` ⇒ skill not in this workspace (route → 404). */
  skillDocs(workspaceId: string, skillId: string): Promise<ContextPaths | undefined>;

  /** `POST /skills/:id/context` — replaces the whole ordered set. */
  setSkillDocs(
    workspaceId: string,
    skillId: string,
    paths: string[],
  ): Promise<ContextPaths | undefined>;

  /**
   * Run path (SPEC-01 AC-16..AC-25): the agent's own attached docs, followed
   * by every ENABLED linked skill's attached docs in `enabledSkillIds` order,
   * deduplicated on first occurrence, read from the live clone and packed
   * under the block budget.
   *
   * `clonePath === null` (repo never cloned) resolves to an all-skipped
   * result, never a throw — a run must not fail because Project Context has
   * nothing to read from.
   */
  resolveForRun(
    clonePath: string | null,
    agentId: string,
    enabledSkillIds: string[],
  ): Promise<ResolvedContextDocs>;
}
