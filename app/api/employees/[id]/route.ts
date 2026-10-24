import { withAuth } from "@/server/auth/guard";
import * as employeeSvc from "@/server/services/employee.service";
import { errorResponse } from "@/server/errors";

/**
 * @fileoverview Single-employee "360" view.
 *
 * @description
 * Backs the `Employee 360` panel shared by the admin and HR employee lists:
 * profile, department, designation, status and employment dates, plus the
 * current salary structure for HR/Admin. Employees may read only their own
 * record — the service enforces that, so the URL cannot be used to enumerate
 * colleagues.
 *
 * @implementation
 *
 * Step 1: Authenticate for any role.
 * Step 2: Read `id` from the route params.
 * Step 3: Delegate to `employeeSvc.get360` (role check inside).
 * Step 4: 404 for unknown ids; 403 for an employee asking about someone else.
 * Step 5: Used by `/admin/employees/[id]` and `/hr/employees/[id]`.
 * Step 6: Salary is absent from the payload for EMPLOYEE callers.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

/**
 * Returns one employee's full profile.
 *
 * @param ctx Route params — `id` is the employee id.
 * @returns The employee row, plus `salary` for HR/Admin.
 */
export const GET = withAuth(
  ["ADMIN", "HR", "EMPLOYEE"],
  async (_req, ctx, user) => {
    try {
      const { id } = await ctx.params;
      return Response.json(await employeeSvc.get360(user, id));
    } catch (e) {
      return errorResponse(e);
    }
  },
);
