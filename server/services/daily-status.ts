/**
 * @fileoverview Per-employee, per-day attendance resolution.
 *
 * @description
 * The single source of truth for "what happened on day X". A day's status is
 * derived, not stored, because several rules interact:
 *
 * | Condition                                   | Status             |
 * |---------------------------------------------|--------------------|
 * | attendance row with check-out, or today      | `present`/`late`/`half_day` |
 * | attendance row without check-out, past day   | `missing_checkout` |
 * | approved paid leave covering the day         | `on_leave`         |
 * | approved unpaid leave covering the day       | `unpaid_leave`     |
 * | none of the above, past working day          | `absent`           |
 *
 * Attendance always wins over leave (a person who checked in is present), and
 * future days and non-working days are omitted entirely so they never count as
 * absences. Attendance, dashboard and payroll all read from this one function,
 * which is what keeps their numbers consistent.
 *
 * @implementation
 *
 * Step 1: Load settings (weekend days, timezone) and the working-day list.
 * Step 2: Resolve "today" in the company timezone.
 * Step 3: Fetch attendance rows and approved leave overlaps in two queries
 *         (not per employee) to stay fast.
 * Step 4: Walk each employee × each working day and apply the table above.
 * Step 5: Return `{ days, today, byEmployee }`; callers that already have the
 *         employee ids can reuse `days` for payroll.
 * Step 6: Verified by attendance-rate and payroll tests; a future day must
 *         never appear, and a missing check-out must on a past day.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

// ── Step 1: dependencies ──────────────────────────────────────────────────────
import { and, between, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "../db";
import { attendance, leaveRequests, leaveTypes } from "../db/schema";
import { getSettings, holidaySet } from "./org.service";
import { workingDays, nowIn } from "../lib/dates";

/** The derived status of one employee on one day. */
export type DayStatus =
  | "present" | "late" | "half_day" | "missing_checkout"
  | "absent" | "on_leave" | "unpaid_leave";

// ── Steps 2–5: resolve ────────────────────────────────────────────────────────

/**
 * Builds a status map for every employee in `empIds` over a date range.
 *
 * @param empIds Employee ids to resolve.
 * @param from   Start `YYYY-MM-DD` (inclusive).
 * @param to     End `YYYY-MM-DD` (inclusive).
 * @returns `{ days, today, byEmployee }` where `byEmployee` maps
 *          employee → (date → status). Days with no workload are absent from
 *          each inner map.
 */
export async function resolveDailyStatuses(empIds: string[], from: string, to: string) {
  const s = await getSettings();
  const { date: today } = nowIn(s.timezone);
  const days = workingDays(from, to, s.weekendDays, await holidaySet(from, to));
  const result = new Map<string, Map<string, DayStatus>>();
  empIds.forEach((id) => result.set(id, new Map()));
  if (!empIds.length) return { days, today, byEmployee: result };

  const [att, leaves] = await Promise.all([
    db.select().from(attendance).where(and(inArray(attendance.employeeId, empIds), between(attendance.date, from, to))),
    db.select({
        employeeId: leaveRequests.employeeId, start: leaveRequests.startDate,
        end: leaveRequests.endDate, isPaid: leaveTypes.isPaid,
      }).from(leaveRequests).innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(and(inArray(leaveRequests.employeeId, empIds), eq(leaveRequests.status, "approved"),
        lte(leaveRequests.startDate, to), gte(leaveRequests.endDate, from))),
  ]);

  const attKey = new Map(att.map((a) => [`${a.employeeId}|${a.date}`, a]));

  for (const id of empIds) {
    const m = result.get(id)!;
    for (const d of days) {
      if (d > today) continue;                       // future days are not absences
      const a = attKey.get(`${id}|${d}`);
      if (a) {
        // Today without a check-out is still in progress, not "missing".
        m.set(d, !a.checkOut && d < today ? "missing_checkout" : a.status);
        continue;
      }
      const lv = leaves.find((l) => l.employeeId === id && l.start <= d && d <= l.end);
      if (lv) { m.set(d, lv.isPaid ? "on_leave" : "unpaid_leave"); continue; }
      if (d < today) m.set(d, "absent");
    }
  }
  return { days, today, byEmployee: result };
}
