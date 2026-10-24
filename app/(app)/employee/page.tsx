import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function EmployeeDashboard() {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            My dashboard
          </h1>
          <p className="text-sm text-zinc-500">
            Clock in, request leave and download payslips.
          </p>
        </div>
        <Badge tone="info">Employee</Badge>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Attendance</CardTitle>
          </CardHeader>
          <CardBody className="text-sm text-zinc-600 dark:text-zinc-400">
            Check in and out, or review this month.
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Leave</CardTitle>
          </CardHeader>
          <CardBody className="text-sm text-zinc-600 dark:text-zinc-400">
            Request leave — try describing it in the assistant and confirm the
            draft.
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Payslips</CardTitle>
          </CardHeader>
          <CardBody className="text-sm text-zinc-600 dark:text-zinc-400">
            Download finalized payslips as PDF.
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
