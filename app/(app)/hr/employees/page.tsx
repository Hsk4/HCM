import { EmployeeDirectory } from "@/components/employees/employee-directory";

/**
 * @fileoverview `/hr/employees` — directory with registration.
 *
 * @description
 * Same component as the admin page; HR owns employee registration, so the
 * action is enabled here too.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */
export default function HrEmployeesPage() {
  return <EmployeeDirectory basePath="/hr" canRegister />;
}
