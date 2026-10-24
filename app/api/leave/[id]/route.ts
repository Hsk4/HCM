import { withAuth } from "@/server/auth/guard";
import * as leave from "@/server/services/leave.service";
import { errorResponse } from "@/server/errors";

/**
 * @fileoverview Cancel one of the caller's own leave requests.
 *
 * @description
 * `DELETE /api/leave/[id]` sets the request to `cancelled`. Only the owner may
 * cancel, and only while the request is `pending` or `approved`; a decided
 * rejection or an already-cancelled request returns 422.
 *
 * @implementation
 *
 * Step 1: Authenticate as EMPLOYEE.
 * Step 2: Read `id` from the route params.
 * Step 3: Delegate to `leave.cancel` (ownership + status checks inside).
 * Step 4: The change is audited with before/after snapshots.
 * Step 5: Used by `/employee/leave`.
 * Step 6: Cancelling someone else's request must return 403.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

/**
 * Cancels a leave request.
 *
 * @param ctx Route params — `id`.
 * @returns The updated request row.
 * @throws 404 unknown; 403 not the owner; 422 already decided.
 */
export const DELETE = withAuth(["EMPLOYEE"], async (_req, ctx, user) => {
  try {
    const { id } = await ctx.params;
    return Response.json(await leave.cancel(user, id));
  } catch (e) {
    return errorResponse(e);
  }
});
