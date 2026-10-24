import { withAuth } from "@/server/auth/guard";
import * as analytics from "@/server/services/analytics.service";
import * as leave from "@/server/services/leave.service";

/**
 * @fileoverview Employee dashboard payload.
 *
 * @description
 * Mirrors `/api/dashboard/hr` for the signed-in employee: their own attendance
 * for the current month plus leave balances. Scoped by `analytics.scopedIds`,
 * which returns only the caller's own employee id for the EMPLOYEE role.
 *
 * @see server/services/analytics.service.ts — `employeeKpis`
 * @see app/api/dashboard/hr/route.ts
 */

/**
 * Returns KPIs for the signed-in employee.
 *
 * @returns `{ attendance, balance }`.
 * @throws 403 when the account has no employee profile.
 */
export const GET = withAuth(["EMPLOYEE"], async (_req, _c, user) => {
  const [{ attendance }, balance] = await Promise.all([
    analytics.employeeKpis(user),
    leave.getBalance(user, user.employeeId!),
  ]);
  return Response.json({ attendance, balance });
});
