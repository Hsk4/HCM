import { EmployeeDirectory } from "@/components/employees/employee-directory";

/**
 * @fileoverview `/admin/employees` — full directory with registration.
 *
 * @description
 * The admin view of the shared employee directory. Registration is enabled here
 * because `POST /api/employees` requires HR; Admin may also register.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */
export default function AdminEmployeesPage() {
  return <EmployeeDirectory basePath="/admin" canRegister />;
}
