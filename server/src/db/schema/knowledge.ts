import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  doublePrecision,
  integer,
  vector,
  index,
} from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { repos } from './repos';

// ============================================================ Knowledge / RAG

export const memory = pgTable(
  'memory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
    scope: text('scope', { enum: ['repo', 'global', 'team'] }).notNull(),
    kind: text('kind', {
      enum: ['decision', 'convention', 'preference', 'fact', 'learning'],
    }).notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    confidence: doublePrecision('confidence'),
    sources: jsonb('sources'),
    createdAt: now(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => ({ wsIdx: index('memory_ws_idx').on(t.workspaceId) }),
);

/**
 * Convention candidates proposed by the extractor, one row per rule.
 *
 * `status` is a tri-state rather than the original `accepted` boolean because a
 * re-scan has to tell "the user rejected this" apart from "not looked at yet" —
 * with a boolean the two are indistinguishable and a rejected rule comes back
 * every scan. Only `pending` rows are replaced by a re-scan; accept/reject are
 * user decisions and survive.
 *
 * `evidenceLine` is derived server-side by locating the snippet in the file, not
 * taken from the model — it is what makes the UI's GitHub deep-link land on the
 * actual code.
 */
export const conventions = pgTable(
  'conventions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
    category: text('category').notNull().default('general'),
    rule: text('rule').notNull(),
    evidencePath: text('evidence_path'),
    evidenceSnippet: text('evidence_snippet'),
    evidenceLine: integer('evidence_line'),
    confidence: doublePrecision('confidence'),
    status: text('status', { enum: ['pending', 'accepted', 'rejected'] })
      .notNull()
      .default('pending'),
    createdAt: now(),
  },
  // Tenancy column leftmost: every query in ConventionsRepository filters
  // workspace_id AND repo_id, and workspace_id is a cascading FK that would
  // otherwise seq-scan this table when a workspace is deleted. Matches the
  // `memory` table above.
  (t) => ({ repoIdx: index('conventions_repo_idx').on(t.workspaceId, t.repoId) }),
);
