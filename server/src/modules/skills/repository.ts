import { and, asc, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { SkillSource, SkillType } from '@devdigest/shared';
import { INITIAL_SKILL_VERSION } from './constants.js';
import { nextSkillVersion } from './helpers.js';

/**
 * A1 — skills data-access. The only layer that touches `skills`,
 * `skill_versions`, `run_skills`, and the SKILL side of `agent_skills` (A2's
 * agents repository owns the agent side: link/reorder for one agent). Every
 * skill query is workspace-scoped.
 */

export type SkillRow = typeof t.skills.$inferSelect;
export type SkillVersionRow = typeof t.skillVersions.$inferSelect;
export type EvalCaseRow = typeof t.evalCases.$inferSelect;
export type EvalRunRow = typeof t.evalRuns.$inferSelect;

export interface InsertSkill {
  workspaceId: string;
  name: string;
  description: string;
  type: SkillType;
  source: SkillSource;
  body: string;
  enabled: boolean;
  evidenceFiles?: string[] | null;
}

export interface UpdateSkill {
  name?: string;
  description?: string;
  type?: SkillType;
  source?: SkillSource;
  body?: string;
  enabled?: boolean;
  evidenceFiles?: string[] | null;
}

export interface SkillFilter {
  type?: SkillType;
  enabled?: boolean;
}

/** One agent that links this skill, with its position in that agent's prompt. */
export interface SkillUsageRow {
  agentId: string;
  agentName: string;
  order: number;
  agentEnabled: boolean;
}

/** One skill that went into a run, as recorded on the run row. */
export interface RunSkillEntry {
  skillId: string;
  skillVersion: number;
  order: number;
}

export interface SkillRunCounts {
  /** All-time runs that included this skill. */
  total: number;
  /** Runs inside the stats window. */
  recent: number;
}

export interface SkillFindingStats {
  total: number;
  recent: number;
  byCategory: { category: string; count: number }[];
  accepted: number;
  dismissed: number;
}

export interface InsertEvalCase {
  workspaceId: string;
  ownerKind: 'skill' | 'agent';
  ownerId: string;
  name: string;
  inputDiff: string;
  inputFiles?: unknown;
  inputMeta?: unknown;
  expectedOutput?: unknown;
  notes?: string | null;
}

export interface UpdateEvalCase {
  name?: string;
  inputDiff?: string;
  inputFiles?: unknown;
  inputMeta?: unknown;
  expectedOutput?: unknown;
  notes?: string | null;
}

export class SkillsRepository {
  constructor(private db: Db) {}

  // ---- skills -------------------------------------------------------------

  async list(workspaceId: string, filter: SkillFilter = {}): Promise<SkillRow[]> {
    const where = [eq(t.skills.workspaceId, workspaceId)];
    if (filter.type !== undefined) where.push(eq(t.skills.type, filter.type));
    if (filter.enabled !== undefined) where.push(eq(t.skills.enabled, filter.enabled));
    return this.db
      .select()
      .from(t.skills)
      .where(and(...where))
      .orderBy(asc(t.skills.name));
  }

  async getById(workspaceId: string, id: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row;
  }

  /**
   * Insert a skill at version 1. NO `skill_versions` row is written here: the
   * history table records BODIES THAT WERE REPLACED, and nothing has been
   * replaced yet. The v1 row is backfilled lazily on the first body edit
   * (`update` below), which is also when its content stops being reachable from
   * `skills.body`.
   */
  async insert(values: InsertSkill): Promise<SkillRow> {
    const [row] = await this.db
      .insert(t.skills)
      .values({
        workspaceId: values.workspaceId,
        name: values.name,
        description: values.description,
        type: values.type,
        source: values.source,
        body: values.body,
        enabled: values.enabled,
        version: INITIAL_SKILL_VERSION,
        evidenceFiles: values.evidenceFiles ?? null,
      })
      .returning();
    return row!;
  }

  /**
   * Update a skill. A changed `body` bumps the version and appends to
   * `skill_versions`; metadata-only edits leave the version alone
   * (`nextSkillVersion` owns that rule).
   *
   * On a bump we write TWO rows: the outgoing body under its own version (the
   * lazy backfill — `onConflictDoNothing` makes it a no-op from the second edit
   * on) and the incoming body under the new version. That invariant — "once a
   * skill has been edited, every version 1..N has a row" — is what lets the
   * history read path stay a plain select.
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkill,
  ): Promise<SkillRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    const { version, bumped } = nextSkillVersion(existing, patch);

    if (bumped) {
      await this.snapshot(existing.id, existing.version, existing.body);
      await this.snapshot(existing.id, version, patch.body!);
    }

    const [row] = await this.db
      .update(t.skills)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.source !== undefined ? { source: patch.source } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.evidenceFiles !== undefined ? { evidenceFiles: patch.evidenceFiles } : {}),
        ...(bumped ? { version } : {}),
      })
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning();
    return row;
  }

  /**
   * Restore an old body as a NEW version. Append-only on purpose: rewinding
   * `skills.version` would make `run_skills.skill_version` ambiguous — two
   * different bodies would have shipped under the same number — and silently
   * rewrite what past runs are recorded as having used.
   */
  async restore(
    workspaceId: string,
    id: string,
    body: string,
  ): Promise<SkillRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;
    const version = existing.version + 1;
    await this.snapshot(existing.id, existing.version, existing.body);
    await this.snapshot(existing.id, version, body);
    const [row] = await this.db
      .update(t.skills)
      .set({ body, version })
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning();
    return row;
  }

  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning({ id: t.skills.id });
    return rows.length > 0;
  }

  private async snapshot(skillId: string, version: number, body: string): Promise<void> {
    await this.db
      .insert(t.skillVersions)
      .values({ skillId, version, body })
      .onConflictDoNothing();
  }

  // ---- skill_versions (immutable body history) ----------------------------

  /** Stored body snapshots, newest version first. */
  async listVersions(skillId: string): Promise<SkillVersionRow[]> {
    return this.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId))
      .orderBy(desc(t.skillVersions.version));
  }

  async getVersion(skillId: string, version: number): Promise<SkillVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skillVersions)
      .where(and(eq(t.skillVersions.skillId, skillId), eq(t.skillVersions.version, version)));
    return row;
  }

  // ---- run_skills (which skills went into a run) --------------------------

  /**
   * Record the skills that were rendered into a run's prompt. Idempotent
   * (PK = run_id + skill_id) so a retried write cannot double-count a run in the
   * stats below.
   */
  async recordRunSkills(runId: string, entries: RunSkillEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.db
      .insert(t.runSkills)
      .values(entries.map((e) => ({ runId, skillId: e.skillId, skillVersion: e.skillVersion, order: e.order })))
      .onConflictDoNothing();
  }

  async runSkillsFor(runId: string): Promise<(typeof t.runSkills.$inferSelect)[]> {
    return this.db
      .select()
      .from(t.runSkills)
      .where(eq(t.runSkills.runId, runId))
      .orderBy(asc(t.runSkills.order));
  }

  // ---- stats --------------------------------------------------------------
  //
  // ATTRIBUTION IS RUN-LEVEL, NOT FINDING-LEVEL. The engine renders every linked
  // skill into ONE `## Skills / rules` prompt section, so no honest mapping from
  // a finding back to a single skill exists. Everything below therefore reads
  // "runs that INCLUDED this skill" and the findings those runs produced — a
  // correlation, which is what the UI says it is. Per-finding attribution would
  // require asking the model to cite the skill, which we do not do.
  //
  // The join always goes through `run_skills`, never `agent_skills`:
  // `agent_skills` holds TODAY's links, so counting through it would credit
  // today's skill set for last month's findings.

  /** Agents that currently link this skill, with their prompt order. */
  async usedBy(workspaceId: string, skillId: string): Promise<SkillUsageRow[]> {
    const rows = await this.db
      .select({
        agentId: t.agents.id,
        agentName: t.agents.name,
        order: t.agentSkills.order,
        agentEnabled: t.agents.enabled,
      })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agents.id, t.agentSkills.agentId))
      .where(and(eq(t.agentSkills.skillId, skillId), eq(t.agents.workspaceId, workspaceId)))
      .orderBy(asc(t.agents.name));
    return rows;
  }

  /** Runs that included this skill: all-time, and inside the window. */
  async runCounts(skillId: string, since: Date): Promise<SkillRunCounts> {
    const rows = await this.db
      .select({ ranAt: t.agentRuns.ranAt })
      .from(t.runSkills)
      .innerJoin(t.agentRuns, eq(t.agentRuns.id, t.runSkills.runId))
      .where(eq(t.runSkills.skillId, skillId));
    return {
      total: rows.length,
      recent: rows.filter((r) => r.ranAt >= since).length,
    };
  }

  /**
   * Findings produced by runs that included this skill.
   *
   * Aggregated in JS from one join rather than four `count()` round-trips: this
   * is a local-first studio, the row count is bounded by one developer's review
   * history, and one query keeps every number derived from exactly the same set.
   */
  async findingStats(skillId: string, since: Date): Promise<SkillFindingStats> {
    const rows = await this.db
      .select({
        category: t.findings.category,
        acceptedAt: t.findings.acceptedAt,
        dismissedAt: t.findings.dismissedAt,
        ranAt: t.agentRuns.ranAt,
      })
      .from(t.runSkills)
      .innerJoin(t.agentRuns, eq(t.agentRuns.id, t.runSkills.runId))
      .innerJoin(t.reviews, eq(t.reviews.runId, t.agentRuns.id))
      .innerJoin(t.findings, eq(t.findings.reviewId, t.reviews.id))
      .where(eq(t.runSkills.skillId, skillId));

    const counts = new Map<string, number>();
    let accepted = 0;
    let dismissed = 0;
    let recent = 0;
    for (const row of rows) {
      counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
      if (row.acceptedAt) accepted += 1;
      if (row.dismissedAt) dismissed += 1;
      if (row.ranAt >= since) recent += 1;
    }
    return {
      total: rows.length,
      recent,
      byCategory: [...counts.entries()]
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category)),
      accepted,
      dismissed,
    };
  }

  // ---- eval cases + runs --------------------------------------------------

  async listEvalCases(
    workspaceId: string,
    ownerKind: 'skill' | 'agent',
    ownerId: string,
  ): Promise<EvalCaseRow[]> {
    return this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, ownerKind),
          eq(t.evalCases.ownerId, ownerId),
        ),
      )
      .orderBy(asc(t.evalCases.name));
  }

  async getEvalCase(workspaceId: string, id: string): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)));
    return row;
  }

  async insertEvalCase(values: InsertEvalCase): Promise<EvalCaseRow> {
    const [row] = await this.db
      .insert(t.evalCases)
      .values({
        workspaceId: values.workspaceId,
        ownerKind: values.ownerKind,
        ownerId: values.ownerId,
        name: values.name,
        inputDiff: values.inputDiff,
        inputFiles: values.inputFiles ?? null,
        inputMeta: values.inputMeta ?? null,
        expectedOutput: values.expectedOutput ?? null,
        notes: values.notes ?? null,
      })
      .returning();
    return row!;
  }

  async updateEvalCase(
    workspaceId: string,
    id: string,
    patch: UpdateEvalCase,
  ): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .update(t.evalCases)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.inputDiff !== undefined ? { inputDiff: patch.inputDiff } : {}),
        ...(patch.inputFiles !== undefined ? { inputFiles: patch.inputFiles } : {}),
        ...(patch.inputMeta !== undefined ? { inputMeta: patch.inputMeta } : {}),
        ...(patch.expectedOutput !== undefined ? { expectedOutput: patch.expectedOutput } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      })
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning();
    return row;
  }

  async deleteEvalCase(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  async insertEvalRun(values: {
    caseId: string;
    pass: boolean;
    actualOutput: unknown;
    recall: number;
    precision: number;
    citationAccuracy: number;
    durationMs: number;
    costUsd: number | null;
  }): Promise<EvalRunRow> {
    const [row] = await this.db
      .insert(t.evalRuns)
      .values({
        caseId: values.caseId,
        pass: values.pass,
        actualOutput: values.actualOutput,
        recall: values.recall,
        precision: values.precision,
        citationAccuracy: values.citationAccuracy,
        durationMs: values.durationMs,
        costUsd: values.costUsd,
      })
      .returning();
    return row!;
  }
}
