/**
 * Excerpt of server/src/db/schema/reviews.ts after the annotations branch.
 * Unrelated tables elided; `reviews` is shown in full.
 */
import { pgTable, uuid, text, integer, index, timestamp } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces.js';
import { pullRequests } from './pull-requests.js';
import { users } from './users.js';
import { now } from './_shared.js';

export const reviews = pgTable('reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id'),
  /** The agent_run that produced this review (links the timeline run ↔ review). */
  runId: uuid('run_id'),
  kind: text('kind', { enum: ['summary', 'review'] }).notNull(),
  verdict: text('verdict'),
  summary: text('summary'),
  score: integer('score'),
  model: text('model'),
  annotationText: text('annotation_text'),
  annotationAuthorId: uuid('annotation_author_id').references(() => users.id, {
    onDelete: 'cascade',
  }),
  annotatedAt: timestamp('annotated_at', { withTimezone: true }),
  createdAt: now(),
});

export const annotationAttachments = pgTable(
  'annotation_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    storageKey: text('storage_key').notNull(),
    createdAt: now(),
  },
  (table) => ({
    reviewIdx: index('annotation_attachments_review_idx').on(table.reviewId),
  }),
);
