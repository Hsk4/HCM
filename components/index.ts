/**
 * @fileoverview Sidebar menu definitions, one per role.
 *
 * @description
 * Single source of truth for navigation. Each role layout imports its own menu
 * and passes it to `<Shell>`, and the same list decides which routes must exist
 * — `href` values here are the contract the route groups in `app/(app)` fulfil.
 *
 * Keep the order intentional: the first entry is the dashboard the user lands on
 * after sign-in (`/{role}`), which `Shell` links the logo to.
 *
 * @implementation
 *
 * Step 1: ADMIN_MENU — company-wide administration.
 * Step 2: HR_MENU — day-to-day people operations.
 * Step 3: EMPLOYEE_MENU — self-service.
 * Step 4: Every `href` must start with the role's own prefix so `Shell` can
 *         compute the active item.
 * Step 5: Imported by `app/(app)/{admin,hr,employee}/layout.tsx`.
 * Step 6: A link added here that has no page shows as a dead route — add the
 *         page in the same change.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

/** Admin navigation: company settings, org data, logins, payroll, audit. */
export const ADMIN_MENU = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/settings", label: "Company settings" },
  { href: "/admin/org", label: "Departments & leave types" },
  { href: "/admin/users", label: "Logins" },
  { href: "/admin/employees", label: "Employees" },
  { href: "/admin/payroll", label: "Payroll" },
  { href: "/admin/announcements", label: "Announcements" },
  { href: "/admin/audit", label: "Audit log" },
];
/** HR navigation: people, attendance, leave approvals, payroll, comms. */
export const HR_MENU = [
  { href: "/hr", label: "Dashboard" },
  { href: "/hr/employees", label: "Employees" },
  { href: "/hr/attendance", label: "Attendance board" },
  { href: "/hr/leave", label: "Leave approvals" },
  { href: "/hr/payroll", label: "Payroll" },
  { href: "/hr/announcements", label: "Announcements" },
];
/** Employee navigation: self-service attendance, leave, payslips, profile. */
export const EMPLOYEE_MENU = [
  { href: "/employee", label: "Dashboard" },
  { href: "/employee/attendance", label: "Attendance" },
  { href: "/employee/leave", label: "Leave" },
  { href: "/employee/payslips", label: "Payslips" },
  { href: "/employee/profile", label: "Profile" },
  { href: "/employee/announcements", label: "Announcements" },
];
