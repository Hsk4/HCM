import { PayrollRuns } from "@/components/payroll/payroll-runs";

/**
 * @fileoverview `/hr/payroll` — draft preparation (no finalize control).
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */
export default function HrPayrollPage() {
  return <PayrollRuns isAdmin={false} />;
}
