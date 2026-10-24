/**
 * @fileoverview Read-only analytics for dashboards and the AI tools.
 *
 * @description
 * One module answers every "how many / who / what rate" question, so the
 * dashboard, the AI assistant and any export agree by construction. Two rules
 * are enforced here rather than in the callers:
 *
 *  1. **Role scoping** — `scopedIds` returns only the caller's own employee id
 *     for EMPLOYEE; company-wide aggregates throw `forbidden()`.
 *  2. **One definition of attendance** — day-level counts come from
 *     `resolveDailyStatuses`, never from ad-hoc `count()` queries, so the
 *     attendance rate shown on the dashboard equals the one payroll uses.
 *
 * Every function takes optional `{ from, to, departmentId }` filters; when
 * omitted they default to the current month in the company timezone.
 *
 * @implementation
 *
 * Step 1: `defaults` resolves the filter window (month start/end + today).
 * Step 2: `scopedIds` applies role scoping and the department filter.
 * Step 3: Aggregate functions — headcount, lateComers, attendanceSummary,
 *         leaveSummary, onLeaveToday, payrollSummary, attrition.
 * Step 4: `hrKpis` / `employeeKpis` compose them into dashboard payloads.
 * Step 5: The AI tool layer (`ai/tools.ts`) calls the same functions.
 * Step 6: An EMPLOYEE must never receive company aggregates (403).
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

// ── Steps 1–2: helpers ────────────────────────────────────────────────────────
import { and, between, count, desc, eq, gte, inArray, lte, or, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { employees, attendance, leaveRequests, leaveTypes, departments, payslips, payrollRuns } from "../db/schema";
import { SessionUser } from "../auth/session";
import { forbidden } from "../errors";
import { resolveDailyStatuses } from "./daily-status";
import { getSettings } from "./org.service";
import { nowIn, monthRange } from "../lib/dates";

/** Optional reporting window; parsed from query params or tool input. */
export type Filters = { from?: string; to?: string; departmentId?: string };

/**
 * Resolves the effective window, defaulting to the current month.
 *
 * @param f Caller filters.
 * @returns `{ from, to, departmentId, today }` with dates in the company zone.
 */
async function defaults(f: Filters) {
  const s = await getSettings();
  const { date } = nowIn(s.timezone);
  const m = monthRange(date.slice(0, 7));
  return { from: f.from ?? m.start, to: f.to ?? m.end, departmentId: f.departmentId, today: date };
}

/**
 * Employee ids in scope for the caller.
 *
 * @param user         The caller.
 * @param departmentId Optional department filter.
 * @returns For EMPLOYEE: only their own id. For HR/Admin: all active/probation
 *          ids, optionally within one department.
 */
async function scopedIds(user: SessionUser, departmentId?: string) {
  if (user.role === "EMPLOYEE") return user.employeeId ? [user.employeeId] : [];
  const rows = await db.select({ id: employees.id }).from(employees)
    .where(and(inArray(employees.status, ["active", "probation"]), departmentId ? eq(employees.departmentId, departmentId) : undefined));
  return rows.map((r) => r.id);
}

// ── Step 3: aggregates ────────────────────────────────────────────────────────

/**
 * Active + probation headcount, grouped by department.
 *
 * @param user The caller (EMPLOYEE is rejected).
 * @param f    Optional department filter.
 * @returns `{ total, byDepartment: [{ department, n }] }`.
 * @throws 403 for EMPLOYEE.
 */
export async function headcount(user: SessionUser, f: Filters = {}) {
  if (user.role === "EMPLOYEE") throw forbidden();
  const rows = await db.select({ department: departments.name, n: count() })
    .from(employees).innerJoin(departments, eq(departments.id, employees.departmentId))
    .where(and(inArray(employees.status, ["active", "probation"]), f.departmentId ? eq(employees.departmentId, f.departmentId) : undefined))
    .groupBy(departments.name);
  return { total: rows.reduce((a, r) => a + r.n, 0), byDepartment: rows };
}

/**
 * Employees ranked by number of late arrivals in the window.
 *
 * @param user The caller (EMPLOYEE is rejected).
 * @param f    Window, department and `limit` (default 5).
 * @returns Rows of `{ employeeId, code, name, lates }`, most late first.
 * @throws 403 for EMPLOYEE.
 */
export async function lateComers(user: SessionUser, f: Filters & { limit?: number } = {}) {
  if (user.role === "EMPLOYEE") throw forbidden();
  const d = await defaults(f);
  return db.select({
      employeeId: employees.id, code: employees.code,
      name: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
      lates: count(),
    })
    .from(attendance).innerJoin(employees, eq(employees.id, attendance.employeeId))
    .where(and(eq(attendance.isLate, true), between(attendance.date, d.from, d.to),
      d.departmentId ? eq(employees.departmentId, d.departmentId) : undefined))
    .groupBy(employees.id).orderBy(desc(count())).limit(f.limit ?? 5);
}

/**
 * Day-level attendance counts and rates for the scope.
 *
 * @param user The caller (EMPLOYEE is scoped to their own days).
 * @param f    Window and department.
 * @returns Per-status counts plus `attendanceRatePct` (half days count 0.5)
 *          and `latePct`; rates are `null` when there is no data.
 */
export async function attendanceSummary(user: SessionUser, f: Filters = {}) {
  const d = await defaults(f);
  const ids = await scopedIds(user, d.departmentId);
  const { byEmployee } = await resolveDailyStatuses(ids, d.from, d.to);

  const c = { present: 0, late: 0, half_day: 0, missing_checkout: 0, absent: 0, on_leave: 0, unpaid_leave: 0 };
  for (const m of byEmployee.values()) for (const st of m.values()) c[st]++;

  // Leave days are not part of the denominator: they were not expected to work.
  const leaveDays = c.on_leave + c.unpaid_leave;
  const records = Object.values(c).reduce((a, b) => a + b, 0) - leaveDays;
  const attended = c.present + c.late + c.missing_checkout + 0.5 * c.half_day;
  return {
    from: d.from, to: d.to, ...c,
    attendanceRatePct: records ? +((attended / records) * 100).toFixed(1) : null,
    latePct: c.present + c.late ? +((c.late / (c.present + c.late)) * 100).toFixed(1) : null,
  };
}

/**
 * Approved leave days grouped by leave type in the window.
 *
 * @param user The caller (EMPLOYEE is scoped to their own leave).
 * @param f    Window and department.
 * @returns Rows of `{ type, days, requests }`.
 */
export async function leaveSummary(user: SessionUser, f: Filters = {}) {
  const d = await defaults(f);
  const ids = await scopedIds(user, d.departmentId);
  if (!ids.length) return [];
  return db.select({ type: leaveTypes.code, days: sql<number>`coalesce(sum(${leaveRequests.days}),0)::int`, requests: count() })
    .from(leaveRequests).innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .where(and(inArray(leaveRequests.employeeId, ids), eq(leaveRequests.status, "approved"),
      lte(leaveRequests.startDate, d.to), gte(leaveRequests.endDate, d.from)))
    .groupBy(leaveTypes.code);
}

/**
 * Who is on approved leave today (company-wide).
 *
 * @param user The caller (EMPLOYEE is rejected).
 * @returns Rows of `{ name, type }`.
 * @throws 403 for EMPLOYEE.
 */
export async function onLeaveToday(user: SessionUser) {
  if (user.role === "EMPLOYEE") throw forbidden();
  const { today } = await defaults({});
  return db.select({ name: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`, type: leaveTypes.code })
    .from(leaveRequests).innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .where(and(eq(leaveRequests.status, "approved"), lte(leaveRequests.startDate, today), gte(leaveRequests.endDate, today)));
}

/**
 * Payroll totals by department for one month.
 *
 * @param user  The caller (EMPLOYEE is rejected).
 * @param month Month key `YYYY-MM`.
 * @returns Rows of `{ department, headcount, gross, net, avgGross }`.
 * @throws 403 for EMPLOYEE.
 */
export async function payrollSummary(user: SessionUser, month: string) {
  if (user.role === "EMPLOYEE") throw forbidden();
  return db.select({
      department: departments.name, headcount: count(),
      gross: sql<number>`round(sum(${payslips.gross}),2)::float`, net: sql<number>`round(sum(${payslips.net}),2)::float`,
      avgGross: sql<number>`round(avg(${payslips.gross}),2)::float`,
    })
    .from(payslips).innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId))
    .innerJoin(employees, eq(employees.id, payslips.employeeId))
    .innerJoin(departments, eq(departments.id, employees.departmentId))
    .where(eq(payrollRuns.month, month)).groupBy(departments.name);
}

/**
 * Attrition for the window: exits over average headcount.
 *
 * @param user The caller (EMPLOYEE is rejected).
 * @param f    Window and department.
 * @returns `{ exits, averageHeadcount, attritionPct }`.
 * @throws 403 for EMPLOYEE.
 */
export async function attrition(user: SessionUser, f: Filters = {}) {
  if (user.role === "EMPLOYEE") throw forbidden();
  const d = await defaults(f);
  // Headcount at the start/end of the window; average of the two is the divisor.
  const [{ exits }] = await db.select({ exits: count() }).from(employees)
    .where(and(between(employees.exitDate, d.from, d.to), d.departmentId ? eq(employees.departmentId, d.departmentId) : undefined));
  const [{ start }] = await db.select({ start: count() }).from(employees)
    .where(and(lte(employees.joinDate, d.from), or(isNull(employees.exitDate), gte(employees.exitDate, d.from))));
  const [{ end }] = await db.select({ end: count() }).from(employees)
    .where(and(lte(employees.joinDate, d.to), or(isNull(employees.exitDate), gte(employees.exitDate, d.to))));
  const avg = (start + end) / 2;
  return { exits, averageHeadcount: avg, attritionPct: avg ? +((exits / avg) * 100).toFixed(1) : 0 };
}

// ── Step 4: composed dashboards ──────────────────────────────────────────────

/**
 * Everything the HR/Admin dashboard (and the AI summary route) needs.
 *
 * @param user The caller (EMPLOYEE is rejected).
 * @param f    Window and department.
 * @returns Headcount, attendance, top late comers, leave by type, pending
 *          approvals and today's check-ins.
 * @throws 403 for EMPLOYEE.
 */
export async function hrKpis(user: SessionUser, f: Filters = {}) {
  if (user.role === "EMPLOYEE") throw forbidden();
  const d = await defaults(f);
  const [hc, att, late, leave, pending, today] = await Promise.all([
    headcount(user, f), attendanceSummary(user, f), lateComers(user, { ...f, limit: 5 }), leaveSummary(user, f),
    db.select({ n: count() }).from(leaveRequests).where(eq(leaveRequests.status, "pending")),
    db.select({ n: count() }).from(attendance).where(eq(attendance.date, d.today)),
  ]);
  return {
    filters: { from: d.from, to: d.to, departmentId: d.departmentId ?? null },
    headcount: hc, attendance: att, topLateComers: late, leaveByType: leave,
    pendingApprovals: pending[0].n, checkedInToday: today[0].n,
  };
}

/**
 * KPIs for the signed-in employee's own dashboard.
 *
 * @param user The signed-in employee.
 * @returns `{ attendance }` scoped to their own days.
 */
export async function employeeKpis(user: SessionUser) {
  const att = await attendanceSummary(user, {});
  return { attendance: att };
}
