import { z } from "zod";
import { withAuth } from "@/server/auth/guard";
import * as attendance from "@/server/services/attendance.service";
import { myHistory, todayBoard } from "@/server/services/attendance-query";
import { nowIn, startOfMonth } from "@/server/lib/dates";
import { getSettings } from "@/server/services/org.service";
import { errorResponse } from "@/server/errors";

/**
 * @fileoverview Attendance endpoint: HR board, personal history, check-in/out.
 *
 * @description
 * Backs `/hr/attendance`, `/employee/attendance` and the check-in buttons.
 *
 *  - `GET` with `?scope=board` → the HR/Admin day board.
 *  - `GET` (default) → the caller's own history and per-status summary.
 *  - `POST ?action=in|out` → check in or check out.
 *
 * @implementation
 *
 * Step 1: `scope=board` is HR/Admin only (`todayBoard` throws otherwise).
 * Step 2: Personal history defaults to the current month.
 * Step 3: `action` selects the write path; anything else is a 400.
 * Step 4: Validation errors surface as 400/409/422 from the service.
 * Step 5: Used by the attendance pages.
 * Step 6: A second check-in on the same day must return 409.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

const rangeQuery = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  date: z.iso.date().optional(),
  departmentId: z.uuid().optional(),
  scope: z.enum(["board", "me"]).optional(),
});

/**
 * Returns the HR board or the caller's own history.
 *
 * @param req Query: `scope=board|me`, `date` (board), `from`/`to` (history).
 * @returns `{ rows }` for the board, `{ rows, days, summary }` for history.
 */
export const GET = withAuth(
  ["ADMIN", "HR", "EMPLOYEE"],
  async (req, _c, user) => {
    try {
      const q = rangeQuery.parse(
        Object.fromEntries(new URL(req.url).searchParams),
      );

      if (q.scope === "board") {
        return Response.json({
          rows: await todayBoard(user, q.date, q.departmentId),
        });
      }

      const today = nowIn((await getSettings()).timezone).date;
      const from = q.from ?? startOfMonth(today);
      const to = q.to ?? today;
      return Response.json(await myHistory(user, from, to));
    } catch (e) {
      return errorResponse(e);
    }
  },
);

/**
 * Checks the caller in or out.
 *
 * @param req Query `?action=in|out`; optional JSON `{ lat, lng, accuracy }`.
 * @returns The attendance row.
 * @throws 400 for an unknown action; 409 on duplicate check-in/out.
 */
export const POST = withAuth(["EMPLOYEE"], async (req, _c, user) => {
  try {
    const action = new URL(req.url).searchParams.get("action");
    const geo = await req.json().catch(() => ({}));
    if (action === "in")
      return Response.json(await attendance.checkIn(user, geo));
    if (action === "out") return Response.json(await attendance.checkOut(user));
    return Response.json(
      {
        error: {
          code: "BAD_REQUEST",
          message: "Query parameter `action` must be `in` or `out`",
        },
      },
      { status: 400 },
    );
  } catch (e) {
    return errorResponse(e);
  }
});
