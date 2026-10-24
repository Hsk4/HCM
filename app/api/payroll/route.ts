import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { withAuth } from "@/server/auth/guard";
import { db } from "@/server/db";
import { payrollRuns, payslips, employees } from "@/server/db/schema";
import * as payroll from "@/server/services/payroll.service";
import { errorResponse } from "@/server/errors";

/**
 * @fileoverview Payroll runs.
 *
 * @description
 * Backs `/admin/payroll` and `/hr/payroll`.
 *
 *  - `GET` lists runs (month, status, headcount, totals) and, for `?month=`,
 *    that run's payslips.
 *  - `POST ?action=draft` regenerates a month's draft (HR).
 *  - `POST ?action=finalize` locks a month (ADMIN only).
 *
 * Drafts are recomputed from attendance, leave and salary in effect at the end
 * of the month, so re-running a draft is always safe; a finalized month cannot
 * be recomputed at all.
 *
 * @implementation
 *
 * Step 1: `GET` returns runs newest-first, with slip counts and totals.
 * Step 2: `?month=` also returns that run's payslips for the detail table.
 * Step 3: `action=draft` validates `YYYY-MM` and delegates to `createDraft`.
 * Step 4: `action=finalize` delegates to `finalize` (ADMIN-only check inside).
 * Step 5: Used by the payroll pages; PDF per slip via `/api/payslips/[id]/pdf`.
 * Step 6: Finalizing twice returns 409; drafting a finalized month returns 409.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

const monthParam = z.string().regex(/^\d{4}-\d{2}$/, "Use YYYY-MM");

/**
 * Lists payroll runs, optionally with one month's payslips.
 *
 * @param req Query `?month=YYYY-MM` to include the payslip detail.
 * @returns `{ runs, detail?: { month, status, slips } }`.
 */
export const GET = withAuth(["ADMIN", "HR"], async (req) => {
  try {
    const url = new URL(req.url);
    const runs = await db
      .select()
      .from(payrollRuns)
      .orderBy(desc(payrollRuns.month));

    const month = url.searchParams.get("month");
    if (!month) return Response.json({ runs });

    const [run] = await db
      .select()
      .from(payrollRuns)
      .where(eq(payrollRuns.month, month));
    if (!run) return Response.json({ runs, detail: null });

    const slips = await db
      .select({
        id: payslips.id,
        employeeId: payslips.employeeId,
        code: employees.code,
        name: employees.firstName,
        lastName: employees.lastName,
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
      .innerJoin(employees, eq(employees.id, payslips.employeeId))
      .where(eq(payslips.runId, run.id))
      .orderBy(employees.code);

    return Response.json({ runs, detail: { ...run, slips } });
  } catch (e) {
    return errorResponse(e);
  }
});

/**
 * Creates a payroll draft or finalizes a month.
 *
 * @param req Query `?action=draft|finalize`; JSON body `{ month: "YYYY-MM" }`.
 * @returns `{ run }`.
 * @throws 400 for a bad action or month; 403 for the wrong role; 409 when locked.
 */
export const POST = withAuth(["ADMIN", "HR"], async (req, _c, user) => {
  try {
    const action = new URL(req.url).searchParams.get("action");
    const { month } = z.object({ month: monthParam }).parse(await req.json());

    if (action === "draft")
      return Response.json({ run: await payroll.createDraft(user, month) });
    if (action === "finalize")
      return Response.json({ run: await payroll.finalize(user, month) });

    return Response.json(
      {
        error: {
          code: "BAD_REQUEST",
          message: "Query parameter `action` must be `draft` or `finalize`",
        },
      },
      { status: 400 },
    );
  } catch (e) {
    return errorResponse(e);
  }
});
