/**
 * @fileoverview Leave: balances, validation, application, cancelling, decisions.
 *
 * @description
 * Leave is the most rule-heavy module. `validate` is the single gate that all
 * writes pass through, so the AI "smart leave" draft and a hand-filled form are
 * judged by exactly the same rules:
 *
 *  1. the leave type must exist;
 *  2. the range must contain at least one working day (weekend/holiday aware);
 *  3. it must not overlap another pending/approved request;
 *  4. the remaining balance must cover it (unlimited types skip this).
 *
 * Balances count both **approved and pending** days, so two pending requests
 * cannot both squeeze into the same remaining quota.
 *
 * @implementation
 *
 * Step 1: `countWorkingDays` — working days via settings + holidays.
 * Step 2: `getBalance` — quota minus used per leave type for a year.
 * Step 3: `validate` — the four rules above; throws on the first failure.
 * Step 4: `apply` / `cancel` / `decide` — transactional writes with audit rows.
 * Step 5: `listOwn` — the employee's own history with type codes joined.
 * Step 6: Verified by payroll/leave tests and by `POST /api/leave` rejecting
 *         overlaps with 422.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

// ── Step 1: dependencies ──────────────────────────────────────────────────────
import { and, desc, eq, inArray, lte, gte, sql } from "drizzle-orm";
import { db } from "../db";
import { leaveRequests, leaveTypes } from "../db/schema";
import { SessionUser } from "../auth/session";
import { forbidden, notFound, unprocessable } from "../errors";
import { getSettings, holidaySet } from "./org.service";
import { workingDays } from "../lib/dates";
import { audit } from "../lib/audit";

// ── Step 1: working-day count ─────────────────────────────────────────────────

/**
 * Counts working days (excluding weekends and public holidays) in a range.
 *
 * @param start Start `YYYY-MM-DD`.
 * @param end   End `YYYY-MM-DD`.
 * @returns Number of working days.
 * @throws 422 when `end` is before `start`.
 */
export async function countWorkingDays(start: string, end: string) {
  if (end < start) throw unprocessable("End date is before start date");
  const s = await getSettings();
  return workingDays(start, end, s.weekendDays, await holidaySet(start, end)).length;
}

// ── Step 2: balances ──────────────────────────────────────────────────────────

/**
 * Remaining leave per type for an employee in a given year.
 *
 * @param user       The caller; employees may only read their own balance.
 * @param employeeId Employee whose balance is requested.
 * @param code       Optional single leave-type code to filter to.
 * @param year       Calendar year (defaults to the current year).
 * @returns `[{ type, quota, used, remaining }]`; `quota`/`remaining` are `null`
 *          for unlimited types.
 * @throws 403 when an employee asks for someone else's balance.
 */
export async function getBalance(user: SessionUser, employeeId: string, code?: string, year = new Date().getFullYear()) {
  if (user.role === "EMPLOYEE" && user.employeeId !== employeeId) throw forbidden();
  const types = await db.select().from(leaveTypes);
  const used = await db.select({
      typeId: leaveRequests.leaveTypeId,
      days: sql<number>`coalesce(sum(${leaveRequests.days}), 0)::int`,
    }).from(leaveRequests)
    .where(and(eq(leaveRequests.employeeId, employeeId),
      // Pending requests reserve days too — otherwise two requests could each
      // pass the balance check and together exceed the quota.
      inArray(leaveRequests.status, ["approved", "pending"]),
      gte(leaveRequests.startDate, `${year}-01-01`), lte(leaveRequests.startDate, `${year}-12-31`)))
    .groupBy(leaveRequests.leaveTypeId);
  const usedMap = new Map(used.map((u) => [u.typeId, u.days]));
  return types
    .filter((t) => !code || t.code === code)
    .map((t) => ({
      type: t.code, quota: t.yearlyQuota, used: usedMap.get(t.id) ?? 0,
      remaining: t.yearlyQuota == null ? null : t.yearlyQuota - (usedMap.get(t.id) ?? 0),
    }));
}

/**
 * Lists the leave types a request may use, with their quotas.
 *
 * @returns `[{ id, code, name, yearlyQuota, isPaid }]` in code order.
 */
export async function listTypes() {
  return db
    .select({ id: leaveTypes.id, code: leaveTypes.code, name: leaveTypes.name, yearlyQuota: leaveTypes.yearlyQuota, isPaid: leaveTypes.isPaid })
    .from(leaveTypes)
    .orderBy(leaveTypes.code);
}

// ── Step 3: validation ────────────────────────────────────────────────────────

/**
 * Applies every leave rule and returns what a valid request would create.
 *
 * @param employeeId Employee applying.
 * @param code       Leave-type code (`annual`, `sick`, `casual`, `unpaid`).
 * @param start      Start `YYYY-MM-DD`.
 * @param end        End `YYYY-MM-DD`.
 * @returns `{ type, days }` — the resolved leave type row and working-day count.
 * @throws 422 on unknown type, empty range, overlap, or insufficient balance.
 */
export async function validate(employeeId: string, code: string, start: string, end: string) {
  const [type] = await db.select().from(leaveTypes).where(eq(leaveTypes.code, code));
  if (!type) throw unprocessable("Unknown leave type");
  const days = await countWorkingDays(start, end);
  if (days === 0) throw unprocessable("Selected dates contain no working days");

  const overlap = await db.select({ id: leaveRequests.id }).from(leaveRequests).where(and(
    eq(leaveRequests.employeeId, employeeId),
    inArray(leaveRequests.status, ["pending", "approved"]),
    lte(leaveRequests.startDate, end), gte(leaveRequests.endDate, start)));
  if (overlap.length) throw unprocessable("You already have leave in this period");

  if (type.yearlyQuota != null) {
    // Balance is a pure read; a synthetic ADMIN scope avoids needing the caller.
    const balanceUser: SessionUser = {
      id: "", email: "", role: "ADMIN", employeeId: null, mustChangePassword: false,
    };
    const [bal] = await getBalance(balanceUser, employeeId, code, +start.slice(0, 4));
    if (days > (bal.remaining ?? 0)) throw unprocessable(`Only ${bal.remaining} ${code} day(s) left`);
  }
  return { type, days };
}

// ── Step 5: read side ─────────────────────────────────────────────────────────

/**
 * Lists the signed-in employee's own leave requests, newest first.
 *
 * @param user The signed-in employee.
 * @returns Their requests with the leave-type code joined in.
 * @throws 403 when the account has no employee profile.
 */
export async function listOwn(user: SessionUser) {
  if (!user.employeeId) throw forbidden();
  return db.select({
    id: leaveRequests.id, type: leaveTypes.code, start: leaveRequests.startDate,
    end: leaveRequests.endDate, days: leaveRequests.days, status: leaveRequests.status,
    reason: leaveRequests.reason, createdAt: leaveRequests.createdAt,
  })
    .from(leaveRequests).innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .where(eq(leaveRequests.employeeId, user.employeeId))
    .orderBy(desc(leaveRequests.createdAt));
}

// ── Step 4: writes ────────────────────────────────────────────────────────────

/**
 * Creates a pending leave request after validating it.
 *
 * @param user  The signed-in employee.
 * @param input `{ type, start, end, reason? }`.
 * @returns The created request row.
 * @throws 403 for non-employees; 422 when validation fails.
 */
export async function apply(user: SessionUser, input: { type: string; start: string; end: string; reason?: string }) {
  if (user.role !== "EMPLOYEE" || !user.employeeId) throw forbidden();
  const { type, days } = await validate(user.employeeId, input.type, input.start, input.end);
  return db.transaction(async (tx) => {
    const [r] = await tx.insert(leaveRequests).values({
      employeeId: user.employeeId!, leaveTypeId: type.id,
      startDate: input.start, endDate: input.end, days, reason: input.reason,
    }).returning();
    await audit(tx, user, "leave.apply", "leave_request", r.id, null, r);
    return r;
  });
}

/**
 * Cancels one of the caller's own pending/approved requests.
 *
 * @param user The signed-in employee.
 * @param id   Request id.
 * @returns The updated row (status `cancelled`).
 * @throws 404 unknown request; 403 not the owner; 422 already decided.
 */
export async function cancel(user: SessionUser, id: string) {
  const [r] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, id));
  if (!r) throw notFound();
  if (r.employeeId !== user.employeeId) throw forbidden();
  if (!["pending", "approved"].includes(r.status)) throw unprocessable("Cannot cancel this request");
  const [after] = await db.update(leaveRequests).set({ status: "cancelled" }).where(eq(leaveRequests.id, id)).returning();
  await audit(db, user, "leave.cancel", "leave_request", id, r, after);
  return after;
}

/**
 * Approves or rejects a pending request (HR only).
 *
 * @param user    The deciding HR user.
 * @param id      Request id.
 * @param approve `true` to approve, `false` to reject.
 * @param comment Optional decision comment.
 * @returns The updated request row.
 * @throws 403 for non-HR; 422 when the request is not pending.
 */
export async function decide(user: SessionUser, id: string, approve: boolean, comment: string) {
  if (user.role !== "HR") throw forbidden("Only HR approves leave");
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(leaveRequests).where(eq(leaveRequests.id, id));
    if (!r || r.status !== "pending") throw unprocessable("Request is not pending");
    const [after] = await tx.update(leaveRequests)
      .set({ status: approve ? "approved" : "rejected", decidedBy: user.id, decisionComment: comment })
      .where(eq(leaveRequests.id, id)).returning();
    await audit(tx, user, `leave.${approve ? "approve" : "reject"}`, "leave_request", id, r, after);
    return after;
  });
}
