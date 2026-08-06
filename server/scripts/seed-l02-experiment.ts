/**
 * Two demo PRs for the L02 control experiment.
 *
 * Each diff carries exactly one defect that its skill teaches a reviewer to
 * catch, and nothing else eye-catching — so the same agent, same model, same
 * diff, run with and without the skill, is a clean A/B where the skill is the
 * only variable. A diff full of obvious bugs would prove nothing: a competent
 * reviewer would flag those with or without the skill.
 *
 * The reviewer reads the diff from `pr_files.patch` (see
 * modules/reviews/diff-loader.ts), so nothing here needs GitHub or a clone.
 *
 * Idempotent by (repo, number), matching seed.ts.
 *
 *   cd server && pnpm exec tsx scripts/seed-l02-experiment.ts
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { createDb } from '../src/db/client.js';
import * as t from '../src/db/schema.js';
import { and, eq } from 'drizzle-orm';

/**
 * PR 901 — the tested branch is the happy path; the error branch has no test.
 *
 * Exported, like `BREAKING_PR_FILES`, so `test/seed-l02-diff.test.ts` can pin
 * the `@@` arithmetic. A header that disagrees with its body is not cosmetic
 * here: `parseUnifiedDiff` numbers each hunk from the NEW-SIDE START, and a
 * finding whose line falls outside the band the parser computed is dropped by
 * the grounding gate — silently, so a broken fixture reads as "the agent found
 * nothing" rather than as a broken fixture.
 */
export const TEST_QUALITY_PATCH = `@@ -1,5 +1,14 @@
 export interface Coupon { code: string; percentOff: number; expiresAt: string }

 export function applyCoupon(total: number, coupon: Coupon): number {
+  if (new Date(coupon.expiresAt).getTime() < Date.now()) {
+    throw new CouponExpiredError(coupon.code);
+  }
+  if (coupon.percentOff < 0 || coupon.percentOff > 100) {
+    throw new InvalidCouponError(coupon.code);
+  }
   return total - total * (coupon.percentOff / 100);
 }
+
+export class CouponExpiredError extends Error {}
+export class InvalidCouponError extends Error {}`;

export const TEST_QUALITY_TEST_PATCH = `@@ -0,0 +1,18 @@
+import { describe, it, expect, vi } from 'vitest';
+import { applyCoupon } from './coupon';
+
+vi.mock('./coupon', async () => {
+  const actual = await vi.importActual<typeof import('./coupon')>('./coupon');
+  return { ...actual, applyCoupon: vi.fn(actual.applyCoupon) };
+});
+
+describe('applyCoupon', () => {
+  it('applies the discount', () => {
+    const coupon = { code: 'SAVE10', percentOff: 10, expiresAt: '2099-01-01' };
+    expect(applyCoupon(200, coupon)).toBe(180);
+  });
+
+  it('was called', () => {
+    expect(applyCoupon).toHaveBeenCalled();
+  });
+});`;

/** PR 902 — a breaking route change dressed up as a tidy-up. */
export const API_CONTRACT_PATCH = `@@ -12,12 +12,11 @@
 export function registerInvoiceRoutes(app: App) {
-  app.get('/invoices/:id', async (req, reply) => {
-    const invoice = await invoices.byId(req.params.id);
-    if (!invoice) return reply.code(404).send({ error: 'not_found' });
-    return reply.code(200).send({
-      id: invoice.id,
-      amount_due: invoice.amountDue,
-      currency: invoice.currency,
-      customer_email: invoice.customerEmail,
-    });
-  });
+  app.get('/invoices/:invoiceId', async (req, reply) => {
+    const invoice = await invoices.byId(req.params.invoiceId);
+    if (!invoice) return reply.code(204).send();
+    return reply.code(200).send({
+      id: invoice.id,
+      total: invoice.amountDue,
+      currency: invoice.currency,
+    });
+  });
 }`;

/**
 * The two seeded PRs, with per-file counts that must agree with the patches
 * above — the PR list renders them, so a lie here is visible in the UI even
 * when the diff itself parses.
 */
export const EXPERIMENT_PRS = [
  {
    number: 901,
    title: 'Validate coupons before applying the discount',
    branch: 'feat/coupon-validation',
    body: 'Adds expiry and range validation to applyCoupon, with a unit test.',
    files: [
      { path: 'src/lib/coupon.ts', additions: 9, deletions: 0, patch: TEST_QUALITY_PATCH },
      {
        path: 'src/lib/coupon.test.ts',
        additions: 18,
        deletions: 0,
        patch: TEST_QUALITY_TEST_PATCH,
      },
    ],
  },
  {
    number: 902,
    title: 'Tidy up the invoice endpoint',
    branch: 'chore/invoice-cleanup',
    body: 'Small cleanup of the invoice route: clearer param name, leaner payload.',
    files: [
      {
        path: 'src/api/routes/invoices.ts',
        additions: 9,
        deletions: 10,
        patch: API_CONTRACT_PATCH,
      },
    ],
  },
] as const;

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const handle = createDb(url);
  const db = handle.db;

  const [ws] = await db.select().from(t.workspaces).where(eq(t.workspaces.name, 'default'));
  if (!ws) throw new Error('run pnpm db:seed first');
  const [repo] = await db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, ws.id), eq(t.repos.fullName, 'acme/payments-api')));
  if (!repo) throw new Error('demo repo missing — run pnpm db:seed first');

  for (const spec of EXPERIMENT_PRS) {
    let [pr] = await db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.repoId, repo.id), eq(t.pullRequests.number, spec.number)));
    if (pr) {
      console.log(`  PR #${spec.number} already present`);
      continue;
    }
    [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId: ws.id,
        repoId: repo.id,
        number: spec.number,
        title: spec.title,
        author: 'dana.lim',
        branch: spec.branch,
        base: 'main',
        headSha: `exp${spec.number}`,
        additions: spec.files.reduce((n, f) => n + f.additions, 0),
        deletions: spec.files.reduce((n, f) => n + f.deletions, 0),
        filesCount: spec.files.length,
        status: 'needs_review',
        body: spec.body,
      })
      .returning();
    await db.insert(t.prFiles).values(spec.files.map((f) => ({ prId: pr!.id, ...f })));
    console.log(`  PR #${spec.number} created (${spec.files.length} file(s))`);
  }

  await handle.close();
}

// CLI entrypoint only — the patches above are imported by `seed-l02-diff.test.ts`,
// and importing this file must not talk to a database. `pathToFileURL` rather
// than a `file://` template: on Windows `process.argv[1]` is a backslash path,
// so the template never matches and the script would exit 0 having done nothing
// (see server/INSIGHTS.md, 2026-07-31).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
