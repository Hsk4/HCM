import { PayrollRuns } from "@/components/payroll/payroll-runs";

/**
 * @fileoverview `/admin/payroll` — drafts plus finalization.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */
export default function AdminPayrollPage() {
  return <PayrollRuns isAdmin />;
}
