import { z } from "zod";
import { desc, eq, inArray } from "drizzle-orm";
import { withAuth } from "@/server/auth/guard";
import { db } from "@/server/db";
import { employees, leaveRequests, leaveTypes } from "@/server/db/schema";
import { errorResponse } from "@/server/errors";

/**
 * @fileoverview HR leave approval queue.
 *
 * @description
 * Lists leave requests across the company for `/hr/leave`, with the employee,
 * leave type and computed day count joined in. Defaults to `pending` because the
 * page's job is to clear the queue; `?status=approved|rejected|cancelled|all`
 * switches the view.
 *
 * @implementation
 *
 * Step 1: Authenticate as HR/Admin.
 * Step 2: Parse the optional `status` filter (default `pending`).
 * Step 3: Join employee + leave type so the UI needs no follow-up calls.
 * Step 4: Newest requests first within the chosen status.
 * Step 5: Decisions go through `/api/leave/requests/[id]`.
 * Step 6: Approving must be reflected here on the next load.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

const query = z.object({
  status: z
    .enum(["pending", "approved", "rejected", "cancelled", "all"])
    .default("pending"),
});

/**
 * Lists leave requests for the HR queue.
 *
 * @param req Query `?status=` (default `pending`, or `all`).
 * @returns `{ requests }` with employee and type details.
 */
export const GET = withAuth(["HR", "ADMIN"], async (req) => {
  try {
    const { status } = query.parse(
      Object.fromEntries(new URL(req.url).searchParams),
    );

    return Response.json({
      requests: await db
        .select({
          id: leaveRequests.id,
          employeeId: leaveRequests.employeeId,
          code: employees.code,
          name: employees.firstName,
          lastName: employees.lastName,
          type: leaveTypes.code,
          start: leaveRequests.startDate,
          end: leaveRequests.endDate,
          days: leaveRequests.days,
          reason: leaveRequests.reason,
          status: leaveRequests.status,
          decisionComment: leaveRequests.decisionComment,
          createdAt: leaveRequests.createdAt,
        })
        .from(leaveRequests)
        .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
        .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
        .where(
          status === "all"
            ? undefined
            : inArray(leaveRequests.status, [
                status as "pending" | "approved" | "rejected" | "cancelled",
              ]),
        )
        .orderBy(desc(leaveRequests.createdAt)),
    });
  } catch (e) {
    return errorResponse(e);
  }
});
