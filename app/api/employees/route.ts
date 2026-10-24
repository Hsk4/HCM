import { withAuth } from "@/server/auth/guard";
import * as employeeSvc from "@/server/services/employee.service";
import { errorResponse } from "@/server/errors";

/**
 * @fileoverview Employee directory.
 *
 * @description
 * Backs `/admin/employees` and `/hr/employees`.
 *
 *  - `GET` lists employees with search, department and status filters plus
 *    pagination. EMPLOYEE callers are scoped to their own record by the service.
 *  - `POST` registers an employee (HR or ADMIN): creates the login, profile, salary
 *    structure and welcome notification in one transaction and returns the
 *    temporary password once.
 *
 * @implementation
 *
 * Step 1: Parse filters with `listSchema` (coerces query strings).
 * Step 2: Delegate to `employeeSvc.list` for role-scoped results.
 * Step 3: Validate registration input with `registerSchema`.
 * Step 4: Delegate to `employeeSvc.register` (HR-only check inside).
 * Step 5: Used by both employees pages and the 360 view.
 * Step 6: An EMPLOYEE caller sees exactly one row; HR sees the company.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

/**
 * Lists employees.
 *
 * @param req Query: `q`, `departmentId`, `status`, `page`, `pageSize`.
 * @returns `{ rows, total, page, pageSize }`.
 * @throws 400 on invalid filter values.
 */
export const GET = withAuth(
  ["ADMIN", "HR", "EMPLOYEE"],
  async (req, _c, user) => {
    try {
      const f = employeeSvc.listSchema.parse(
        Object.fromEntries(new URL(req.url).searchParams),
      );
      return Response.json(await employeeSvc.list(user, f));
    } catch (e) {
      return errorResponse(e);
    }
  },
);

/**
 * Registers a new employee.
 *
 * @param req JSON body per `registerSchema`.
 * @returns `{ employee, login: { email, temporaryPassword } }` (201).
 * @throws 403 for other roles; 409 when the email exists; 400 on invalid input.
 */
export const POST = withAuth(["HR", "ADMIN"], async (req, _c, user) => {
  try {
    const input = employeeSvc.registerSchema.parse(await req.json());
    return Response.json(await employeeSvc.register(user, input), {
      status: 201,
    });
  } catch (e) {
    return errorResponse(e);
  }
});
