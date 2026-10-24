/**
 * @fileoverview Attendance: check-in/out and correction decisions.
 *
 * @description
 * Employees check in and out once per day. Lateness and half-days are decided
 * against company *office time* (settings timezone + office start + grace),
 * never server time. The `(employee_id, date)` unique index makes a duplicate
 * check-in impossible at the storage layer, so the race between two devices on
 * the same account resolves to one row instead of two.
 *
 * @implementation
 *
 * Step 1: `checkIn` resolves the local date and minute-of-day, decides
 *         `late` vs `present`, and inserts with `onConflictDoNothing`.
 * Step 2: A no-op insert means the day already exists → `409 Already checked in`.
 * Step 3: `checkOut` finds today's row, refuses a second check-out, computes
 *         worked minutes and downgrades to `half_day` below the threshold.
 * Step 4: `listPendingCorrections` / `decideCorrection` handle the HR queue;
 *         approving applies the corrected times via `applyCorrection`.
 * Step 5: Every decision is audited.
 * Step 6: Duplicate check-ins must 409; a short day must become `half_day`.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

// ── Step 1: dependencies ──────────────────────────────────────────────────────
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";
import { attendance, attendanceCorrections } from "../db/schema";
import { SessionUser } from "../auth/session";
import { conflict, forbidden, unprocessable } from "../errors";
import { getSettings } from "./org.service";
import { hhmmToMinutes, nowIn } from "../lib/dates";
import { audit } from "../lib/audit";

/** Optional device location attached to a check-in. */
type Geo = { lat?: number; lng?: number; accuracy?: number };

/**
 * Writes an approved correction onto the attendance row for that day.
 *
 * Creates the row when the employee never checked in, otherwise updates the
 * requested times. `"HH:MM"` values are interpreted in the company timezone.
 *
 * @param tx The open transaction.
 * @param c  The approved correction record.
 * @returns Resolves after the attendance row is written (or skipped when there
 *          is no check-in time and no existing row).
 */
async function applyCorrection(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  c: typeof attendanceCorrections.$inferSelect,
) {
  const s = await getSettings();
  const toSub = (hhmm: string) => {
    // Offset between UTC and the company zone at this wall-clock time.
    const probe = new Date(`${c.date}T${hhmm}:00Z`);
    const local = new Intl.DateTimeFormat("en-GB", {
      timeZone: s.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(probe);
    const [lh, lm] = local.split(":").map(Number);
    const target = hhmmToMinutes(hhmm);
    return new Date(probe.getTime() + (target - (lh * 60 + lm)) * 60_000);
  };

  const checkIn = c.requestedCheckIn ? toSub(c.requestedCheckIn) : undefined;
  const checkOut = c.requestedCheckOut ? toSub(c.requestedCheckOut) : undefined;
  const isLate =
    c.requestedCheckIn != null &&
    hhmmToMinutes(c.requestedCheckIn) > hhmmToMinutes(s.officeStart) + s.graceMinutes;

  const [existing] = await tx.select().from(attendance)
    .where(and(eq(attendance.employeeId, c.employeeId), eq(attendance.date, c.date)));

  if (existing) {
    const worked = checkIn && checkOut
      ? Math.floor((checkOut.getTime() - checkIn.getTime()) / 60_000)
      : existing.workedMinutes;
    await tx.update(attendance)
      .set({
        checkIn: checkIn ?? existing.checkIn,
        checkOut: checkOut ?? existing.checkOut,
        isLate: checkIn ? isLate : existing.isLate,
        status: isLate ? "late" : "present",
        workedMinutes: worked,
        source: "correction",
      })
      .where(eq(attendance.id, existing.id));
    return;
  }

  if (!checkIn) return; // nothing to create without a check-in time
  await tx.insert(attendance).values({
    employeeId: c.employeeId, date: c.date, checkIn, checkOut,
    isLate, status: isLate ? "late" : "present", source: "correction",
    workedMinutes: checkOut ? Math.floor((checkOut.getTime() - checkIn.getTime()) / 60_000) : null,
  });
}

// ── Steps 1–2: check in ───────────────────────────────────────────────────────

/**
 * Records the caller's check-in for today.
 *
 * @param user The signed-in employee.
 * @param geo  Optional location and source (`web` | `camera`).
 * @returns The created attendance row.
 * @throws 403 for non-employees or accounts without a profile.
 * @throws 409 `Already checked in today` when a row already exists.
 */
export async function checkIn(user: SessionUser, geo: Geo & { source?: "web" | "camera" } = {}) {
  if (user.role !== "EMPLOYEE" || !user.employeeId) throw forbidden();
  const s = await getSettings();
  const { date, minutes } = nowIn(s.timezone);

  // Late = strictly after office start + grace (09:00 + 15 → after 09:15).
  const isLate = minutes > hhmmToMinutes(s.officeStart) + s.graceMinutes;
  const [row] = await db.insert(attendance).values({
    employeeId: user.employeeId, date, checkIn: new Date(),
    status: isLate ? "late" : "present", isLate, source: geo.source ?? "web",
    lat: geo.lat, lng: geo.lng, accuracyM: geo.accuracy,
  }).onConflictDoNothing({ target: [attendance.employeeId, attendance.date] }).returning();

  if (!row) throw conflict("Already checked in today");
  return row;
}

// ── Step 3: check out ─────────────────────────────────────────────────────────

/**
 * Records the caller's check-out for today and finalises worked minutes.
 *
 * @param user The signed-in employee.
 * @returns The updated attendance row.
 * @throws 403 for non-employees; 422 when no check-in exists today; 409 on a
 *         second check-out.
 */
export async function checkOut(user: SessionUser) {
  if (user.role !== "EMPLOYEE" || !user.employeeId) throw forbidden();
  const s = await getSettings();
  const { date } = nowIn(s.timezone);
  const [rec] = await db.select().from(attendance)
    .where(and(eq(attendance.employeeId, user.employeeId), eq(attendance.date, date)));
  if (!rec) throw unprocessable("You have not checked in today");
  if (rec.checkOut) throw conflict("Already checked out");

  const now = new Date();
  const worked = Math.floor((now.getTime() - rec.checkIn.getTime()) / 60000);
  const status = worked < s.halfDayMinutes ? "half_day" : rec.status;
  const [after] = await db.update(attendance)
    .set({ checkOut: now, workedMinutes: worked, status })
    .where(eq(attendance.id, rec.id)).returning();
  return after;
}

// ── Step 4: corrections ───────────────────────────────────────────────────────

/**
 * Lists pending attendance corrections for the HR board, oldest first.
 *
 * @returns The pending queue.
 */
export async function listPendingCorrections() {
  return db
    .select()
    .from(attendanceCorrections)
    .where(eq(attendanceCorrections.status, "pending"))
    .orderBy(asc(attendanceCorrections.date));
}

/**
 * Approves or rejects a correction request. Approving applies the times.
 *
 * @param user    The deciding HR user.
 * @param id      Correction id.
 * @param approve `true` to approve, `false` to reject.
 * @param comment Optional decision comment stored for the employee.
 * @returns Resolves when the decision and any attendance update are committed.
 * @throws 403 for non-HR; 422 when the request is not pending.
 */
export async function decideCorrection(user: SessionUser, id: string, approve: boolean, comment?: string) {
  if (user.role !== "HR") throw forbidden("Only HR approves corrections");
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(attendanceCorrections).where(eq(attendanceCorrections.id, id));
    if (!c || c.status !== "pending") throw unprocessable("Request is not pending");
    await tx.update(attendanceCorrections)
      .set({ status: approve ? "approved" : "rejected", decidedBy: user.id, decisionComment: comment })
      .where(eq(attendanceCorrections.id, id));
    if (approve) await applyCorrection(tx, c);
    await audit(tx, user, `correction.${approve ? "approve" : "reject"}`, "attendance_correction", id, c, { comment });
  });
}
