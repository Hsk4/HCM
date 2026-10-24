import { z } from "zod";
import { withAuth } from "@/server/auth/guard";
import { db } from "@/server/db";
import { attendanceCorrections } from "@/server/db/schema";
import { listPendingCorrections } from "@/server/services/attendance.service";
import { errorResponse } from "@/server/errors";

/**
 * @fileoverview Attendance correction queue.
 *
 * @description
 * An employee who forgot to check in or out files a correction; HR approves or
 * rejects it through `/api/attendance/corrections/[id]`, which writes the
 * corrected times onto the attendance row.
 *
 *  - `GET`  → pending queue (HR).
 *  - `POST` → file a new correction (EMPLOYEE).
 *
 * @implementation
 *
 * Step 1: `GET` lists pending requests oldest-first for the HR board.
 * Step 2: `POST` validates the date and at least one requested time.
 * Step 3: A correction is always created `pending`; HR decides.
 * Step 4: Times are `HH:MM` strings, applied in the company timezone.
 * Step 5: Used by `/hr/attendance` and `/employee/attendance`.
 * Step 6: Filing a correction must not change attendance until approved.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

const body = z
  .object({
    date: z.iso.date(),
    requestedCheckIn: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    requestedCheckOut: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    reason: z.string().min(3).max(500),
  })
  .refine((v) => v.requestedCheckIn || v.requestedCheckOut, {
    message: "Provide a requested check-in or check-out time",
  });

/**
 * Lists pending corrections (HR).
 *
 * @returns `{ requests }`.
 */
export const GET = withAuth(["HR"], async () => {
  try {
    return Response.json({ requests: await listPendingCorrections() });
  } catch (e) {
    return errorResponse(e);
  }
});

/**
 * Files a correction for the signed-in employee.
 *
 * @param req JSON body `{ date, requestedCheckIn?, requestedCheckOut?, reason }`.
 * @returns The created correction (201).
 * @throws 403 when the account has no employee profile; 400 on invalid input.
 */
export const POST = withAuth(["EMPLOYEE"], async (req, _c, user) => {
  try {
    const input = body.parse(await req.json());
    if (!user.employeeId) {
      return Response.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "No employee profile for this account",
          },
        },
        { status: 403 },
      );
    }
    const [created] = await db
      .insert(attendanceCorrections)
      .values({
        employeeId: user.employeeId,
        date: input.date,
        requestedCheckIn: input.requestedCheckIn,
        requestedCheckOut: input.requestedCheckOut,
        reason: input.reason,
      })
      .returning();
    return Response.json(created, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
});
