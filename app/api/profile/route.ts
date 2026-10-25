import { z } from "zod";
import { withAuth } from "@/server/auth/guard";
import * as employeeSvc from "@/server/services/employee.service";
import { errorResponse } from "@/server/errors";

/**
 * @fileoverview The signed-in employee's own profile.
 *
 * @description
 * Backs `/employee/profile`. Employees can read their profile and update only
 * their own contact details (phone, address). Everything else — department,
 * designation, salary, status — is HR-managed, so there is no field for it here.
 * Salary is deliberately not returned: an employee already sees it on payslips,
 * and keeping it out of this payload keeps the shape identical to the 360 view.
 *
 * @implementation
 *
 * Step 1: `GET` resolves `employeeId` from the session and reuses `get360`.
 * Step 2: `PATCH` validates `{ phone?, address? }` only.
 * Step 3: The write is scoped to the caller and audited before/after.
 * Step 4: 403 when the account has no employee profile.
 * Step 5: Used by `/employee/profile`.
 * Step 6: A crafted body containing `departmentId` must be ignored (stripped).
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

const patchBody = z.object({
  phone: z.string().max(32).optional(),
  address: z.string().max(300).optional(),
});

/**
 * Returns the caller's own profile.
 *
 * @returns The employee row.
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
    return Response.json(await employeeSvc.get360(user, user.employeeId));
  } catch (e) {
    return errorResponse(e);
  }
});

/**
 * Updates the caller's contact details.
 *
 * @param req JSON body `{ phone?, address? }`.
 * @returns The updated employee row.
 */
export const PATCH = withAuth(["EMPLOYEE"], async (req, _c, user) => {
  try {
    const input = patchBody.parse(await req.json());
    return Response.json(await employeeSvc.updateOwnContact(user, input));
  } catch (e) {
    return errorResponse(e);
  }
});
