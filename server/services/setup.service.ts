/**
 * @fileoverview First-run provisioning.
 *
 * @description
 * Creates everything a fresh database needs: the company row, the first ADMIN
 * login, and the default leave types. The leave types are **rules, not demo
 * data** — quotas drive balance validation, so they are seeded here rather than
 * left for an operator to remember.
 *
 * The whole operation is one transaction and is idempotent. A second call (page
 * reload, double submit, two taps on a slow connection) reports
 * `alreadySetUp: true` instead of throwing, because a `409` would leave the
 * `/setup` page unable to show "done".
 *
 * @implementation
 *
 * Step 1: `needsSetup` — is the singleton settings row missing?
 * Step 2: `runSetup` — transaction: guard, insert settings, admin, leave types,
 *         audit, return the admin id.
 * Step 3: `bootstrapFromEnv` — optional hands-off provisioning from env vars.
 * Step 4: Errors roll the transaction back; partial setup is impossible.
 * Step 5: Used by `app/api/setup/route.ts`.
 * Step 6: Calling `runSetup` twice must create exactly one admin.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

// ── Step 1: dependencies ──────────────────────────────────────────────────────
import { db } from "../db";
import { users, settings, leaveTypes } from "../db/schema";
import { hashPassword } from "../auth/password";
import { audit } from "../lib/audit";
import { env } from "../env";

/**
 * True when no company settings row exists yet (i.e. first run).
 *
 * @returns `true` if the app still needs first-time setup.
 */
export async function needsSetup() {
  const rows = await db.select({ id: settings.id }).from(settings).limit(1);
  return rows.length === 0;
}

/**
 * Creates the company, the first admin login and the default leave types.
 *
 * @param input Company name plus the admin's email and initial password.
 * @returns `{ adminId, alreadySetUp }` — `alreadySetUp: true` means the call
 *          was a no-op because setup had already completed (`adminId` is `null`).
 */
export async function runSetup(input: { companyName: string; adminEmail: string; adminPassword: string }) {
  return db.transaction(async (tx) => {
    const existing = await tx.select({ id: settings.id }).from(settings).limit(1);
    // Idempotent: the `/setup` page may be opened twice, or POSTed twice.
    // Throwing would surface a 409 on a page that only needs to say "done".
    if (existing.length) return { adminId: null, alreadySetUp: true };

    await tx.insert(settings).values({ id: 1, companyName: input.companyName });
    const [admin] = await tx.insert(users).values({
      email: input.adminEmail.toLowerCase(),
      passwordHash: await hashPassword(input.adminPassword),
      role: "ADMIN",
    }).returning();

    // Default quotas come from the company policy (see ai/prompts.ts POLICY).
    await tx.insert(leaveTypes).values([
      { code: "annual", name: "Annual", yearlyQuota: 14, isPaid: true },
      { code: "sick", name: "Sick", yearlyQuota: 8, isPaid: true },
      { code: "casual", name: "Casual", yearlyQuota: 10, isPaid: true },
      { code: "unpaid", name: "Unpaid", yearlyQuota: null, isPaid: false },
    ]);
    await audit(tx, null, "setup.complete", "company", "1", null, { companyName: input.companyName });
    return { adminId: admin.id, alreadySetUp: false };
  });
}

// ── Step 3: optional env bootstrap ────────────────────────────────────────────

/**
 * Runs setup from `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `COMPANY_NAME` when the
 * database is still empty. Safe to call on every boot; it is a no-op after the
 * first success.
 *
 * @returns Resolves when done (or skipped).
 */
export async function bootstrapFromEnv() {
  if (!(await needsSetup())) return;
  if (env.ADMIN_EMAIL && env.ADMIN_PASSWORD)
    await runSetup({ companyName: env.COMPANY_NAME || "My Company", adminEmail: env.ADMIN_EMAIL, adminPassword: env.ADMIN_PASSWORD });
}
