/**
 * @fileoverview Append-only audit trail and in-app notifications.
 *
 * @description
 * Every sensitive mutation (login, employee changes, leave decisions, payroll,
 * AI calls) writes a row to `audit_logs` in the *same transaction* as the
 * change, so an action can never commit without its audit record. Table dumps
 * are not used: `audit_logs` is append-only by convention and only readable by
 * ADMIN through `/api/audit`.
 *
 * @implementation
 *
 * Step 1: Accept either a transaction or the db handle
 *  - `Runner` lets callers pass `tx` (inside `db.transaction`) or `db`.
 *
 * Step 2: Write the audit row
 *  - `audit()` stores actor id/role, action, entity, entity id and optional
 *    before/after JSON snapshots.
 *
 * Step 3: Write notifications
 *  - `notify()` inserts a per-user notification used by the bell in the shell.
 *
 * Step 4: Validation
 *  - Actors may be `null` for system events (e.g. first-run setup).
 *
 * Step 5: Integration
 *  - Called by every service in `server/services/*` and by the auth routes.
 *
 * Step 6: Verification
 *  - Rows are visible under `/api/audit` (ADMIN only) after any mutation.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

// ── Step 1: dependencies ──────────────────────────────────────────────────────
import { db, Tx } from "../db";
import { auditLogs, notifications } from "../db/schema";
import { SessionUser } from "../auth/session";

type Runner = Tx | typeof db;

/**
 * JSON payload type accepted by the `audit_logs` snapshot columns. Using the
 * column's own inferred type avoids `any` while still accepting any snapshot.
 */
type AuditJson = typeof auditLogs.$inferInsert["before"];

// ── Step 2: audit write ───────────────────────────────────────────────────────

/**
 * Records an audit entry.
 *
 * @param r        Transaction (`tx`) or the db handle.
 * @param actor    The acting user, or `null` for system events.
 * @param action   Dot-namespaced verb, e.g. `"leave.approve"`.
 * @param entity   Table/domain touched, e.g. `"leave_request"`.
 * @param entityId Primary key of the affected row, if any.
 * @param before   Snapshot before the change (defaults to `null`).
 * @param after    Snapshot after the change (defaults to `null`).
 * @returns Resolves when the row is written.
 * @throws Any database error — callers inside a transaction will roll back.
 */
export async function audit(
  r: Runner, actor: SessionUser | null,
  action: string, entity: string, entityId: string | null,
  before: unknown = null, after: unknown = null,
) {
  await r.insert(auditLogs).values({
    actorId: actor?.id ?? null, actorRole: actor?.role ?? null,
    action, entity, entityId, before: before as AuditJson, after: after as AuditJson,
  });
}

// ── Step 3: notifications ─────────────────────────────────────────────────────

/**
 * Creates an in-app notification for one user.
 *
 * @param r      Transaction or db handle.
 * @param userId Recipient user id.
 * @param title  Short headline shown in the list.
 * @param body   Optional detail text.
 * @param link   Optional in-app link to the relevant page.
 * @returns Resolves when the row is written.
 */
export async function notify(r: Runner, userId: string, title: string, body?: string, link?: string) {
  await r.insert(notifications).values({ userId, title, body, link });
}
