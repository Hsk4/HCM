import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function AdminDashboard() {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            Admin dashboard
          </h1>
          <p className="text-sm text-zinc-500">
            Company-wide view. Ask the assistant on the right for insights.
          </p>
        </div>
        <Badge tone="info">Admin</Badge>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Setup</CardTitle>
          </CardHeader>
          <CardBody className="text-sm text-zinc-600 dark:text-zinc-400">
            Create departments, logins and employees from the menu.
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Payroll</CardTitle>
          </CardHeader>
          <CardBody className="text-sm text-zinc-600 dark:text-zinc-400">
            Draft, finalize and export payslips.
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Audit</CardTitle>
          </CardHeader>
          <CardBody className="text-sm text-zinc-600 dark:text-zinc-400">
            Every sensitive change is recorded and immutable.
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
