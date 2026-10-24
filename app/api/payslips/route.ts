import { and, desc, eq } from "drizzle-orm";
import { withAuth } from "@/server/auth/guard";
import { db } from "@/server/db";
import { employees, payrollRuns, payslips } from "@/server/db/schema";
import { errorResponse } from "@/server/errors";

/**
 * @fileoverview The signed-in employee's payslips.
 *
 * @description
 * Backs `/employee/payslips`. Employees only ever see their **own finalized**
 * slips — drafts stay invisible until payroll is locked, which is what makes a
 * payslip a committed document rather than a preview.
 *
 * @implementation
 *
 * Step 1: Authenticate; reject accounts without an employee profile.
 * Step 2: Join each slip to its run for the month and status.
 * Step 3: Filter by the caller's employee id and `finalized` runs.
 * Step 4: Newest month first.
 * Step 5: The PDF link points at `/api/payslips/[id]/pdf`.
 * Step 6: A draft slip id must return 403/404 from the PDF route.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

/**
 * Lists the caller's finalized payslips.
 *
 * @returns `{ payslips: [{ id, month, gross, net, deduction, tax }] }`.
 * @throws 403 when the account has no employee profile.
 */
export const GET = withAuth(["EMPLOYEE"], async (_req, _c, user) => {
  try {
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

    const rows = await db
      .select({
        id: payslips.id,
        month: payrollRuns.month,
        code: employees.code,
        basic: payslips.basic,
        gross: payslips.gross,
        deduction: payslips.deduction,
        tax: payslips.tax,
        net: payslips.net,
        workingDays: payslips.workingDays,
        absentDays: payslips.absentDays,
        unpaidDays: payslips.unpaidDays,
        halfDays: payslips.halfDays,
      })
      .from(payslips)
      .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId))
      .innerJoin(employees, eq(employees.id, payslips.employeeId))
      .where(and(eq(payslips.employeeId, user.employeeId), eq(payrollRuns.status, "finalized")))
      .orderBy(desc(payrollRuns.month));

    return Response.json({ payslips: rows });
  } catch (e) {
    return errorResponse(e);
  }
});
