"use client";

/**
 * @fileoverview Employee directory: search, filter, paginate, view 360, register.
 *
 * @description
 * One component serves `/admin/employees` and `/hr/employees`, because both show
 * the same data and the API already role-scopes the results. Only the
 * registration action differs: the API accepts `POST /api/employees` from HR
 * only, so the button is hidden for other roles rather than shown as a failing
 * control.
 *
 * @implementation
 *
 * Step 1: Keep page, search text and filters in state; debounce would be nice
 *         but a submit/Enter search keeps it predictable.
 * Step 2: Build the query string and load `{ rows, total }`.
 * Step 3: Render a table with row navigation to the 360 view.
 * Step 4: "Register" opens a modal: personal details, department, salary.
 * Step 5: The returned temporary password is surfaced once, like new logins.
 * Step 6: Pagination is disabled at the ends and shows the total.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { useJson } from "@/lib/use-json";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { Modal } from "@/components/modal";
import { Alert } from "@/components/ui/alert";
import { ErrorNote, PageHeader, StateRow, SuccessNote } from "@/components/page-kit";

type Row = {
  id: string;
  code: string;
  firstName: string;
  lastName: string;
  department: string;
  status: "probation" | "active" | "exited";
  joinDate: string;
};

type Page = { rows: Row[]; total: number; page: number; pageSize: number };
type Dept = { id: string; name: string };

const STATUS_TONE = { active: "success", probation: "warning", exited: "neutral" } as const;

/**
 * Renders the employee directory.
 *
 * @param props.basePath  Route prefix for the 360 link (`/admin` or `/hr`).
 * @param props.canRegister Whether to show the registration action.
 * @returns The directory page content.
 */
export function EmployeeDirectory({
  basePath,
  canRegister,
}: {
  basePath: string;
  canRegister: boolean;
}) {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [status, setStatus] = useState("");
  const pageSize = 20;

  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (q) query.set("q", q);
  if (departmentId) query.set("departmentId", departmentId);
  if (status) query.set("status", status);

  const { data, error, loading, reload } = useJson<Page>(`/api/employees?${query}`, [
    page,
    q,
    departmentId,
    status,
  ]);
  const depts = useJson<Dept[]>("/api/org?type=department");

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [login, setLogin] = useState<{ email: string; password: string } | null>(null);

  const [form, setForm] = useState({
    email: "",
    firstName: "",
    lastName: "",
    departmentId: "",
    joinDate: new Date().toISOString().slice(0, 10),
    basicSalary: "",
    phone: "",
    address: "",
    status: "active" as "active" | "probation",
  });

  /** Opens a fresh registration form. */
  function openRegister() {
    setProblem(null);
    setForm({
      email: "",
      firstName: "",
      lastName: "",
      departmentId: depts.data?.[0]?.id ?? "",
      joinDate: new Date().toISOString().slice(0, 10),
      basicSalary: "",
      phone: "",
      address: "",
      status: "active",
    });
    setOpen(true);
  }

  async function register(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setProblem(null);
    try {
      const res = await api<{ login: { email: string; temporaryPassword: string } }>("/api/employees", {
        method: "POST",
        body: JSON.stringify({
          email: form.email,
          firstName: form.firstName,
          lastName: form.lastName,
          departmentId: form.departmentId,
          joinDate: form.joinDate,
          basicSalary: Number(form.basicSalary),
          phone: form.phone || undefined,
          address: form.address || undefined,
          status: form.status,
        }),
      });
      setOpen(false);
      setLogin({ email: res.login.email, password: res.login.temporaryPassword });
      setNotice("Employee registered.");
      reload();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Could not register employee");
    } finally {
      setSaving(false);
    }
  }

  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Employees"
        subtitle={`${total} ${total === 1 ? "person" : "people"} in the directory.`}
        actions={
          canRegister && (
            <Button size="sm" onClick={openRegister}>
              Register employee
            </Button>
          )
        }
      />

      <SuccessNote message={notice} />
      <ErrorNote message={problem} />

      {login && (
        <Alert tone="warning" title="Copy the temporary password now">
          <p className="text-sm">
            <span className="font-medium">{login.email}</span> →{" "}
            <code className="rounded bg-black/5 px-1.5 py-0.5 font-mono dark:bg-white/10">{login.password}</code>
          </p>
        </Alert>
      )}

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setQ(search.trim());
        }}
      >
        <Field label="Search" htmlFor="q">
          <Input
            id="q"
            placeholder="Name or code"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56"
          />
        </Field>
        <Field label="Department" htmlFor="dept">
          <Select
            id="dept"
            value={departmentId}
            onChange={(e) => {
              setDepartmentId(e.target.value);
              setPage(1);
            }}
            className="w-48"
          >
            <option value="">All departments</option>
            {depts.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status" htmlFor="status">
          <Select
            id="status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="w-36"
          >
            <option value="">Any</option>
            <option value="active">Active</option>
            <option value="probation">Probation</option>
            <option value="exited">Exited</option>
          </Select>
        </Field>
        <Button type="submit" size="sm" variant="secondary">
          Search
        </Button>
        {(q || departmentId || status) && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setSearch("");
              setQ("");
              setDepartmentId("");
              setStatus("");
              setPage(1);
            }}
          >
            Clear
          </Button>
        )}
      </form>

      <Card>
        <CardBody className="p-0">
          <Table>
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Name</Th>
                <Th>Department</Th>
                <Th>Joined</Th>
                <Th>Status</Th>
                <Th className="text-right">View</Th>
              </tr>
            </thead>
            <tbody>
              <StateRow
                loading={loading}
                error={error}
                empty={!loading && !error && (data?.rows.length ?? 0) === 0}
                emptyText={q || status || departmentId ? "No employees match those filters." : "No employees yet."}
                colSpan={6}
              />
              {data?.rows.map((r) => (
                <tr key={r.id}>
                  <Td className="font-mono text-xs">{r.code}</Td>
                  <Td className="font-medium">
                    {r.firstName} {r.lastName}
                  </Td>
                  <Td>{r.department}</Td>
                  <Td className="font-mono text-xs">{r.joinDate}</Td>
                  <Td>
                    <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                  </Td>
                  <Td className="text-right">
                    <Link href={`${basePath}/employees/${r.id}`} className="text-sm text-sky-700 hover:underline dark:text-sky-400">
                      Open
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>

      <div className="flex items-center justify-between text-sm text-zinc-500">
        <span>
          Page {page} of {lastPage}
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <Button size="sm" variant="secondary" disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      </div>

      <Modal
        open={open}
        title="Register employee"
        wide
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" onClick={register} disabled={saving}>
              {saving ? "Registering…" : "Register"}
            </Button>
          </>
        }
      >
        <form onSubmit={register} className="grid gap-3 sm:grid-cols-2">
          <ErrorNote message={problem} />

          <Field label="First name" htmlFor="firstName">
            <Input
              id="firstName"
              required
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
            />
          </Field>
          <Field label="Last name" htmlFor="lastName">
            <Input
              id="lastName"
              required
              value={form.lastName}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
            />
          </Field>

          <div className="sm:col-span-2">
            <Field label="Email" hint="Becomes the sign-in address" htmlFor="email">
              <Input
                id="email"
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
          </div>

          <Field label="Department" htmlFor="departmentId">
            <Select
              id="departmentId"
              required
              value={form.departmentId}
              onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
            >
              <option value="">Select…</option>
              {depts.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Join date" htmlFor="joinDate">
            <Input
              id="joinDate"
              type="date"
              required
              value={form.joinDate}
              onChange={(e) => setForm({ ...form, joinDate: e.target.value })}
            />
          </Field>

          <Field label="Basic salary" hint="Gross = 1.5 × basic" htmlFor="basicSalary">
            <Input
              id="basicSalary"
              type="number"
              min={1}
              step="any"
              required
              value={form.basicSalary}
              onChange={(e) => setForm({ ...form, basicSalary: e.target.value })}
            />
          </Field>

          <Field label="Status" htmlFor="empStatus">
            <Select
              id="empStatus"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as "active" | "probation" })}
            >
              <option value="active">Active</option>
              <option value="probation">Probation</option>
            </Select>
          </Field>

          <Field label="Phone (optional)" htmlFor="phone">
            <Input id="phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <Field label="Address (optional)" htmlFor="address">
            <Input id="address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
