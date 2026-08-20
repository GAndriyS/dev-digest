import type { BlastRadius } from '@devdigest/shared';

/**
 * Blast Radius (L04) — the module's public surface for other modules.
 * `modules/brief/**` (L05) reaches this through `container.blast` rather than
 * importing `service.ts` directly, because `no-cross-module-internals`
 * forbids the latter (`.dependency-cruiser.cjs:83-97`). Mirrors the
 * `container.projectContext` / `ProjectContext` precedent
 * (`modules/context/types.ts`).
 */
export interface Blast {
  /**
   * The impact map for a PR's changed files, straight from the repo-intel
   * index — same call `GET /pulls/:id/blast` makes. `status` says how much
   * of the index actually backed the answer (`full` | `partial` |
   * `degraded`); a caller MUST NOT read `degraded`/`partial` as "nothing
   * depends on this".
   */
  getBlast(workspaceId: string, prId: string): Promise<BlastRadius>;
}
