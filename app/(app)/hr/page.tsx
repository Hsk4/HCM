import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function HrDashboard() {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">HR dashboard</h1>
          <p className="text-sm text-zinc-500">Headcount, attendance and leave for your team.</p>
        </div>
        <Badge tone="info">HR</Badge>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Attendance</CardTitle>
          </CardHeader>
          <CardBody className="text-sm text-zinc-600 dark:text-zinc-400">
            Today&apos;s board, late comers and corrections.
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Leave approvals</CardTitle>
          </CardHeader>
          <CardBody className="text-sm text-zinc-600 dark:text-zinc-400">
            Approve or reject pending requests.
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Payroll</CardTitle>
          </CardHeader>
          <CardBody className="text-sm text-zinc-600 dark:text-zinc-400">
            Run monthly payroll and review payslips.
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
