/**
 * @fileoverview Read-only attendance queries for the boards and personal views.
 *
 * @description
 * `attendance.service.ts` owns the write paths (check in/out, corrections).
 * This module owns the *reads* that the UI needs, and it deliberately builds on
 * `resolveDailyStatuses` so the HR board, the employee history and the
 * dashboard all derive a day from the same rules.
 *
 * @implementation
 *
 * Step 1: `todayBoard` — every scoped employee's status for one day.
 * Step 2: `myHistory` — one employee's raw attendance rows for a range.
 * Step 3: Scoping: HR/Admin see everyone; an employee sees only themselves.
 * Step 4: Unknown department ids simply return an empty board.
 * Step 5: Used by `/api/attendance` and `/api/attendance/today`.
 * Step 6: A day with no record and no leave must read `absent` on the board.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

import { and, between, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { attendance, departments, employees } from "../db/schema";
import { SessionUser } from "../auth/session";
import { resolveDailyStatuses } from "./daily-status";
import { nowIn } from "../lib/dates";
import { getSettings } from "./org.service";
import { forbidden } from "../errors";

/**
 * One row of the HR attendance board.
 */
export type BoardRow = {
  employeeId: string;
  code: string;
  name: string;
  department: string;
  status: string | null;
  checkIn: string | null;
  checkOut: string | null;
  workedMinutes: number | null;
  isLate: boolean;
};

/**
 * Builds the attendance board for a single day.
 *
 * @param user The caller; an EMPLOYEE is rejected (they use their own history).
 * @param date Optional `YYYY-MM-DD` (defaults to today in the company zone).
 * @param departmentId Optional department filter.
 * @returns Rows ordered by employee code, with each person's status for the day.
 * @throws 403 for EMPLOYEE callers.
 */
export async function todayBoard(
  user: SessionUser,
  date?: string,
  departmentId?: string,
): Promise<BoardRow[]> {
  if (user.role === "EMPLOYEE") throw forbidden();
  const s = await getSettings();
  const day = date ?? nowIn(s.timezone).date;

  const people = await db
    .select({
      employeeId: employees.id,
      code: employees.code,
      name: employees.firstName,
      lastName: employees.lastName,
      department: departments.name,
    })
    .from(employees)
    .innerJoin(departments, eq(departments.id, employees.departmentId))
    .where(
      and(
        inArray(employees.status, ["active", "probation"]),
        departmentId ? eq(employees.departmentId, departmentId) : undefined,
      ),
    )
    .orderBy(employees.code);

  const ids = people.map((p) => p.employeeId);
  const { byEmployee } = await resolveDailyStatuses(ids, day, day);

  const rows = await db
    .select()
    .from(attendance)
    .where(
      and(
        eq(attendance.date, day),
        inArray(attendance.employeeId, ids.length ? ids : [""]),
      ),
    );

  const byId = new Map(rows.map((r) => [r.employeeId, r]));

  return people.map((p) => {
    const rec = byId.get(p.employeeId);
    return {
      employeeId: p.employeeId,
      code: p.code,
      name: `${p.name} ${p.lastName}`,
      department: p.department,
      status: byEmployee.get(p.employeeId)?.get(day) ?? null,
      checkIn: rec?.checkIn ? rec.checkIn.toISOString() : null,
      checkOut: rec?.checkOut ? rec.checkOut.toISOString() : null,
      workedMinutes: rec?.workedMinutes ?? null,
      isLate: rec?.isLate ?? false,
    };
  });
}

/**
 * Returns one employee's attendance records for a date range.
 *
 * @param employeeId Employee to read.
 * @param from Start `YYYY-MM-DD`.
 * @param to End `YYYY-MM-DD`.
 * @returns Attendance rows, newest first.
 */
export async function records(employeeId: string, from: string, to: string) {
  return db
    .select()
    .from(attendance)
    .where(
      and(
        eq(attendance.employeeId, employeeId),
        between(attendance.date, from, to),
      ),
    )
    .orderBy(desc(attendance.date));
}

/**
 * The caller's own attendance for a range, with per-day derived statuses.
 *
 * @param user The signed-in employee.
 * @param from Start `YYYY-MM-DD`.
 * @param to End `YYYY-MM-DD`.
 * @returns `{ rows, days, summary }` — raw rows, resolved day statuses and
 *          per-status counts for the range.
 * @throws 403 when the account has no employee profile.
 */
export async function myHistory(user: SessionUser, from: string, to: string) {
  if (!user.employeeId) throw forbidden();
  const rows = await records(user.employeeId, from, to);
  const { days, byEmployee } = await resolveDailyStatuses(
    [user.employeeId],
    from,
    to,
  );
  const mine = byEmployee.get(user.employeeId) ?? new Map<string, string>();

  const summary = {
    present: 0,
    late: 0,
    half_day: 0,
    missing_checkout: 0,
    absent: 0,
    on_leave: 0,
    unpaid_leave: 0,
  } as Record<string, number>;
  for (const status of mine.values())
    summary[status] = (summary[status] ?? 0) + 1;

  return {
    rows,
    days: days.map((d) => ({ date: d, status: mine.get(d) ?? null })),
    summary,
  };
}
