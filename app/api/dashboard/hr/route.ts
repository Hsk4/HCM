import { z } from "zod";
import { withAuth } from "@/server/auth/guard";
import * as analyticsService from "@/server/services/analytics.service";

/**
 * @fileoverview HR/Admin dashboard payload.
 *
 * @description
 * One request returns every aggregate the HR dashboard renders: headcount,
 * attendance counts and rates, top late comers, leave by type, pending leave
 * approvals and today's check-ins. Filters come from the query string; when
 * omitted the service defaults to the current month in the company timezone.
 *
 * The same payload feeds `POST /api/ai/summary`, which is why the AI insights
 * can never contradict the numbers on screen.
 *
 * @implementation
 *
 * Step 1: Authenticate as HR or ADMIN.
 * Step 2: Parse `from`, `to`, `departmentId` from the query string.
 * Step 3: Delegate to `analytics.hrKpis` (role scoping happens there).
 * Step 4: Invalid dates/UUIDs are rejected by Zod as 400 `VALIDATION`.
 * Step 5: Consumed by `app/(app)/hr/page.tsx` and the admin dashboard.
 * Step 6: An EMPLOYEE must receive 403.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

/**
 * Returns HR KPIs for the requested window.
 *
 * @param req Query string: `from?`, `to?`, `departmentId?`.
 * @returns The `hrKpis` object.
 * @throws 400 on invalid filter values; 403 for EMPLOYEE.
 */
export const GET = withAuth(["HR", "ADMIN"], async (req, _c, user) => {
  const q = Object.fromEntries(new URL(req.url).searchParams);
  const f = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional(), departmentId: z.uuid().optional() }).parse(q);
  return Response.json(await analyticsService.hrKpis(user, f));
});