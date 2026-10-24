"use client";

/**
 * @fileoverview Employee 360 view — profile, employment and (for HR/Admin) salary.
 *
 * @description
 * The single detail screen behind both `/admin/employees/[id]` and
 * `/hr/employees/[id]`. It deliberately renders whatever fields the API returns:
 * `salary` is absent for EMPLOYEE callers, so the salary card simply does not
 * appear rather than being hidden by a client-side role check.
 *
 * @implementation
 *
 * Step 1: Load `/api/employees/[id]`.
 * Step 2: Show identity, contact and employment details.
 * Step 3: Show the current salary structure when present.
 * Step 4: 403/404 from the API render as an inline error, not a blank page.
 * Step 5: "Back" returns to the role's directory.
 * Step 6: An employee opening a colleague's id must see the 403 message.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

import Link from "next/link";
import { use } from "react";
import { useJson } from "@/lib/use-json";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorNote, PageHeader } from "@/components/page-kit";

type Employee = {
  id: string;
  code: string;
  firstName: string;
  lastName: string;
  gender: string | null;
  phone: string | null;
  address: string | null;
  joinDate: string;
  exitDate: string | null;
  status: "probation" | "active" | "exited";
  salary?: {
    basic: number;
    hraPct: number;
    medicalPct: number;
    effectiveFrom: string;
  } | null;
};

const money = (n: number) =>
  n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/**
 * Renders one employee's 360 view.
 *
 * @param props.id       Employee id from the route.
 * @param props.basePath Route prefix for the back link.
 * @returns The detail page content.
 */
export function Employee360({
  id,
  basePath,
}: {
  id: string;
  basePath: string;
}) {
  const { data, error, loading } = useJson<Employee>(`/api/employees/${id}`);

  if (loading)
    return <p className="text-sm text-zinc-500">Loading employee…</p>;
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;

  const gross = data.salary
    ? data.salary.basic *
      (1 + data.salary.hraPct / 100 + data.salary.medicalPct / 100)
    : null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={`${data.firstName} ${data.lastName}`}
        subtitle={`${data.code} · joined ${data.joinDate}`}
        actions={
          <>
            <Badge
              tone={
                data.status === "active"
                  ? "success"
                  : data.status === "probation"
                    ? "warning"
                    : "neutral"
              }
            >
              {data.status}
            </Badge>
            <Link
              href={`${basePath}/employees`}
              className="text-sm text-sky-700 hover:underline dark:text-sky-400"
            >
              Back to employees
            </Link>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardBody>
            <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
              <dt className="text-zinc-500">Employee code</dt>
              <dd className="font-mono">{data.code}</dd>
              <dt className="text-zinc-500">Name</dt>
              <dd>
                {data.firstName} {data.lastName}
              </dd>
              <dt className="text-zinc-500">Gender</dt>
              <dd>{data.gender || "—"}</dd>
              <dt className="text-zinc-500">Phone</dt>
              <dd>{data.phone || "—"}</dd>
              <dt className="text-zinc-500">Address</dt>
              <dd>{data.address || "—"}</dd>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Employment</CardTitle>
          </CardHeader>
          <CardBody>
            <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
              <dt className="text-zinc-500">Status</dt>
              <dd>{data.status}</dd>
              <dt className="text-zinc-500">Join date</dt>
              <dd className="font-mono">{data.joinDate}</dd>
              <dt className="text-zinc-500">Exit date</dt>
              <dd className="font-mono">{data.exitDate || "—"}</dd>
            </dl>
          </CardBody>
        </Card>

        {data.salary !== undefined && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Salary structure</CardTitle>
            </CardHeader>
            <CardBody>
              {data.salary ? (
                <dl className="grid grid-cols-2 gap-y-2 text-sm sm:grid-cols-4">
                  <dt className="text-zinc-500">Basic</dt>
                  <dd className="font-mono">{money(data.salary.basic)}</dd>
                  <dt className="text-zinc-500">HRA / Medical</dt>
                  <dd className="font-mono">
                    {data.salary.hraPct}% / {data.salary.medicalPct}%
                  </dd>
                  <dt className="text-zinc-500">Gross</dt>
                  <dd className="font-mono">{money(gross ?? 0)}</dd>
                  <dt className="text-zinc-500">Effective from</dt>
                  <dd className="font-mono">{data.salary.effectiveFrom}</dd>
                </dl>
              ) : (
                <p className="text-sm text-zinc-500">
                  No salary structure on file.
                </p>
              )}
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}

/**
 * Route-param adapter for Next 16, where `params` is a promise.
 *
 * @param props.params Promise resolving to `{ id }`.
 * @param props.basePath Route prefix for links.
 * @returns The 360 view.
 */
export function Employee360Page({
  params,
  basePath,
}: {
  params: Promise<{ id: string }>;
  basePath: string;
}) {
  const { id } = use(params);
  return <Employee360 id={id} basePath={basePath} />;
}
