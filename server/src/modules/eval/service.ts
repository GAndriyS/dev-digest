import type { Container } from '../../platform/container.js';
import type { EvalCase, EvalOwnerKind } from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { DuplicateEvalCaseError, EvalRepository } from './repository.js';
import type { EvalCaseRow } from './types.js';
import { normalizeFilePath } from './helpers.js';

/**
 * eval — agent-side service (SPEC-05, step 7). CRUD over `eval_cases` for
 * `owner_kind = 'agent'`, plus the "Turn into eval case" action (AC-3..AC-6)
 * that mints a case out of an already-decided finding. The skill side keeps
 * living in `modules/skills/service.ts` — untouched (Non-goals).
 *
 * Takes `Container`, never `FastifyRequest` (`server/AGENTS.md`), and reaches
 * `findings`/`pr_files` ONLY through `container.reviewRepo` — never an inline
 * query on another module's table (`onion-architecture`, Blind spots §4).
 */

/** Wire-shaped create/update payload — mirrors `EvalCaseInput` (contracts/eval-ci.ts). */
export interface EvalCaseInput {
  owner_kind: EvalOwnerKind;
  owner_id: string;
  name: string;
  input_diff: string;
  input_files?: unknown;
  input_meta?: unknown;
  expected_output?: unknown;
  notes?: string | null;
}

/** `POST /findings/:id/eval-case` result — `created` is the 201-vs-200
 *  discriminant the route (step 10) answers with; the body (`case`) is the
 *  same `EvalCase` either way (AC-6). */
export interface CreateEvalCaseFromFindingResult {
  case: EvalCase;
  created: boolean;
}

export class EvalService {
  private repo: EvalRepository;

  constructor(private container: Container) {
    this.repo = new EvalRepository(container.db);
  }

  // ---- plain CRUD (agent-owned cases only) ---------------------------------
  //
  // No `update` here (fix pass, item 1 — was dead code): `PUT /eval-cases/:id`
  // is registered once, generically, on `skills/routes.ts` and dispatches to
  // `SkillsService.updateEvalCase` → `SkillsRepository#updateEvalCase`, which
  // filters by workspace+id only (not `owner_kind`) and already serves both
  // owners — see the doc comment on `eval/routes.ts` for why there is no
  // second, agent-scoped `PUT` here.

  async list(workspaceId: string, agentId: string): Promise<EvalCase[]> {
    const rows = await this.repo.listAgentCases(workspaceId, agentId);
    return rows.map(toEvalCaseDto);
  }

  async get(workspaceId: string, id: string): Promise<EvalCase> {
    return toEvalCaseDto(await this.requireAgentCase(workspaceId, id));
  }

  async create(workspaceId: string, input: EvalCaseInput): Promise<EvalCase> {
    if (input.owner_kind !== 'agent') {
      throw new AppError(
        'unsupported_eval_owner',
        'This endpoint only creates agent-owned eval cases.',
        400,
      );
    }
    const row = await this.repo.insertCase({
      workspaceId,
      ownerKind: 'agent',
      ownerId: input.owner_id,
      name: input.name,
      inputDiff: input.input_diff,
      inputFiles: input.input_files,
      inputMeta: input.input_meta,
      expectedOutput: input.expected_output,
      notes: input.notes ?? null,
    });
    return toEvalCaseDto(row);
  }

  async delete(workspaceId: string, id: string): Promise<string> {
    await this.requireAgentCase(workspaceId, id);
    const ok = await this.repo.deleteCase(workspaceId, id);
    if (!ok) throw new NotFoundError('Eval case not found');
    return id;
  }

  // ---- "Turn into eval case" (AC-3..AC-6) ----------------------------------

  /**
   * Mint (or return the existing) eval case for one finding.
   *
   * - Owner is the review's agent (`review.agentId`), not the caller.
   * - `input_diff` is the `pr_files` row whose `path` matches the finding's
   *   file, normalized on both sides (`normalizeFilePath` — the same
   *   comparison the scorer uses, so a case never fails to match its own
   *   source file). A missing row or an empty patch both refuse with a
   *   message that names the situation, never the diff/patch text itself
   *   (AC-5's secret-leak edge case: a `stripe-key-leak`-style finding must
   *   not put its secret into an error message).
   * - Accepted finding → one `must_find` expectation built from the finding's
   *   own fields; dismissed finding → `must_not_flag` (`findings: []`) with a
   *   human-readable pointer to the dismissed finding in `notes` — the scorer
   *   (`helpers.ts#expectedFindings`) never reads `notes`.
   * - Neither decision set → refuse (AC-2's server-side backstop; the UI
   *   already disables the button, but the API must not trust that alone).
   * - Repeat call for the same finding → `created: false` with the existing
   *   row, never a second case (AC-6), matched via
   *   `EvalRepository#findCaseBySourceFinding`.
   */
  async createCaseFromFinding(
    workspaceId: string,
    findingId: string,
  ): Promise<CreateEvalCaseFromFindingResult> {
    const context = await this.container.reviewRepo.findingContext(findingId);
    if (!context || context.pull.workspaceId !== workspaceId) {
      throw new NotFoundError('Finding not found');
    }
    const { finding, review, pull } = context;

    const agentId = review.agentId;
    if (!agentId) {
      throw new AppError(
        'eval_case_no_agent',
        'This finding has no owning agent and cannot become an eval case.',
        422,
      );
    }

    const existing = await this.repo.findCaseBySourceFinding(workspaceId, agentId, findingId);
    if (existing) return { case: toEvalCaseDto(existing), created: false };

    const accepted = finding.acceptedAt != null;
    const dismissed = finding.dismissedAt != null;
    if (!accepted && !dismissed) {
      throw new AppError(
        'eval_case_no_decision',
        'Accept or dismiss this finding before turning it into an eval case.',
        422,
      );
    }

    const prFiles = await this.container.reviewRepo.getPrFiles(pull.id);
    const target = normalizeFilePath(finding.file);
    const fileRow = prFiles.find((f) => normalizeFilePath(f.path) === target);
    if (!fileRow || !fileRow.patch || fileRow.patch.trim().length === 0) {
      // Never interpolate the diff/patch content here (secret-leak edge case).
      throw new AppError('eval_case_no_diff', 'No diff text for this file.', 422);
    }

    const expectedOutput = accepted
      ? {
          findings: [
            {
              file: finding.file,
              start_line: finding.startLine,
              end_line: finding.endLine,
              severity: finding.severity,
              category: finding.category,
              title: finding.title,
            },
          ],
        }
      : { findings: [] as unknown[] };

    const notes = accepted
      ? null
      : `Dismissed finding — ${finding.file}:${finding.startLine}-${finding.endLine} — ${finding.title}`;

    try {
      const row = await this.repo.insertCase({
        workspaceId,
        ownerKind: 'agent',
        ownerId: agentId,
        name: finding.title,
        inputDiff: fileRow.patch,
        expectedOutput,
        notes,
        sourceFindingId: findingId,
      });
      return { case: toEvalCaseDto(row), created: true };
    } catch (err) {
      // AC-6 under a race (fix pass, item 8): two concurrent "Turn into eval
      // case" clicks for the SAME finding both pass the
      // `findCaseBySourceFinding` check above (neither sees the other's row
      // yet — there is no row to see), then one insert wins and the other
      // hits the partial unique index `eval_cases_owner_source_finding_uq`.
      // Re-read and answer with the winner's row instead of bubbling a 500 —
      // the loser still gets the idempotent 200 AC-6 promises. Any OTHER
      // error (a different constraint, a connection failure, …) rethrows.
      // The Postgres wire-error introspection lives in the repository
      // (`DuplicateEvalCaseError`) — this layer catches by domain type only.
      if (err instanceof DuplicateEvalCaseError) {
        const existing = await this.repo.findCaseBySourceFinding(workspaceId, agentId, findingId);
        if (existing) return { case: toEvalCaseDto(existing), created: false };
      }
      throw err;
    }
  }

  // ---- shared lookups -------------------------------------------------------

  /** Scoped fetch that also enforces the module boundary (AC-28): a
   *  skill-owned case id is "not found" from this (agent-only) service's
   *  point of view, not a cross-owner leak. Mirrors `skills/service.ts`'s
   *  `require()` shape. */
  private async requireAgentCase(workspaceId: string, id: string): Promise<EvalCaseRow> {
    const row = await this.repo.getCase(workspaceId, id);
    if (!row || row.ownerKind !== 'agent') throw new NotFoundError('Eval case not found');
    return row;
  }
}

// ---- DTO mapping --------------------------------------------------------

/** Mirrors `skills/helpers.ts#toEvalCaseDto`, plus `source_finding_id`
 *  (AC-6/AC-3) which the skill-owned DTO never sets. */
function toEvalCaseDto(row: EvalCaseRow): EvalCase {
  return {
    id: row.id,
    owner_kind: row.ownerKind as EvalOwnerKind,
    owner_id: row.ownerId,
    name: row.name,
    input_diff: row.inputDiff ?? '',
    input_files: row.inputFiles ?? null,
    input_meta: row.inputMeta ?? null,
    expected_output: row.expectedOutput ?? null,
    notes: row.notes,
    source_finding_id: row.sourceFindingId ?? null,
  };
}
