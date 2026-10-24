"use client";

/**
 * @fileoverview `/admin/users` — login accounts.
 *
 * @description
 * Manages credentials separately from profiles: create a login with a role,
 * change a role, deactivate an account, or force a password reset. Accounts are
 * never deleted (the audit log references the actor), so "remove access" means
 * deactivate. A new login receives a one-time temporary password shown once.
 *
 * @implementation
 *
 * Step 1: List logins with role, status and linked employee.
 * Step 2: "New login" opens a modal for email + role.
 * Step 3: The returned temporary password is shown and must be copied now.
 * Step 4: Role change and activate/deactivate are inline selects/buttons.
 * Step 5: The API refuses to remove the last active admin; the error is shown.
 * Step 6: Reload after every mutation.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

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
import {
  ErrorNote,
  PageHeader,
  StateRow,
  SuccessNote,
} from "@/components/page-kit";

type Login = {
  id: string;
  email: string;
  role: "ADMIN" | "HR" | "EMPLOYEE";
  isActive: boolean;
  mustChangePassword: boolean;
  employeeCode: string | null;
  firstName: string | null;
  lastName: string | null;
};

const ROLE_TONE = {
  ADMIN: "info",
  HR: "warning",
  EMPLOYEE: "neutral",
} as const;

/**
 * Renders the logins page.
 *
 * @returns The users page content.
 */
export default function AdminUsersPage() {
  const { data, error, loading, reload } = useJson<Login[]>("/api/users");

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Login["role"]>("EMPLOYEE");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [temp, setTemp] = useState<{ email: string; password: string } | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setProblem(null);
    try {
      const res = await api<{
        user: { email: string };
        temporaryPassword: string;
      }>("/api/users", {
        method: "POST",
        body: JSON.stringify({ email, role }),
      });
      setOpen(false);
      setEmail("");
      setTemp({ email: res.user.email, password: res.temporaryPassword });
      reload();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Could not create login");
    } finally {
      setSaving(false);
    }
  }

  async function patch(
    id: string,
    body: Partial<Pick<Login, "role" | "isActive" | "mustChangePassword">>,
  ) {
    setNotice(null);
    setProblem(null);
    try {
      await api(`/api/users?id=${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setNotice("Saved.");
      reload();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Could not update login");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Logins"
        subtitle="Credentials only — employee details live under Employees."
        actions={
          <Button size="sm" onClick={() => setOpen(true)}>
            New login
          </Button>
        }
      />

      <SuccessNote message={notice} />
      <ErrorNote message={problem} />

      {temp && (
        <Alert tone="warning" title="Copy the temporary password now">
          <p className="text-sm">
            <span className="font-medium">{temp.email}</span> →{" "}
            <code className="rounded bg-black/5 px-1.5 py-0.5 font-mono dark:bg-white/10">
              {temp.password}
            </code>
          </p>
          <p className="mt-1 text-xs">
            It is shown once and must be changed at first sign-in.
          </p>
        </Alert>
      )}

      <Card>
        <CardBody className="p-0">
          <Table>
            <thead>
              <tr>
                <Th>Email</Th>
                <Th>Employee</Th>
                <Th>Role</Th>
                <Th>Status</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              <StateRow
                loading={loading}
                error={error}
                empty={!loading && !error && (data?.length ?? 0) === 0}
                colSpan={5}
              />
              {data?.map((u) => (
                <tr key={u.id}>
                  <Td className="font-medium">{u.email}</Td>
                  <Td className="text-xs text-zinc-500">
                    {u.employeeCode
                      ? `${u.employeeCode} · ${u.firstName} ${u.lastName}`
                      : "—"}
                  </Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <Badge tone={ROLE_TONE[u.role]}>{u.role}</Badge>
                      <Select
                        aria-label={`Role for ${u.email}`}
                        className="w-auto py-1 text-xs"
                        value={u.role}
                        onChange={(e) =>
                          patch(u.id, { role: e.target.value as Login["role"] })
                        }
                      >
                        <option value="ADMIN">ADMIN</option>
                        <option value="HR">HR</option>
                        <option value="EMPLOYEE">EMPLOYEE</option>
                      </Select>
                    </div>
                  </Td>
                  <Td>
                    <Badge tone={u.isActive ? "success" : "danger"}>
                      {u.isActive ? "Active" : "Inactive"}
                    </Badge>
                    {u.mustChangePassword && (
                      <span className="ml-2 text-[11px] text-amber-600">
                        must change password
                      </span>
                    )}
                  </Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          patch(u.id, { mustChangePassword: true })
                        }
                        title="Require a password change at next sign-in"
                      >
                        Force reset
                      </Button>
                      <Button
                        size="sm"
                        variant={u.isActive ? "danger" : "primary"}
                        onClick={() => patch(u.id, { isActive: !u.isActive })}
                      >
                        {u.isActive ? "Deactivate" : "Activate"}
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>

      <Modal
        open={open}
        title="New login"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={create} disabled={saving}>
              {saving ? "Creating…" : "Create"}
            </Button>
          </>
        }
      >
        <form onSubmit={create} className="flex flex-col gap-3">
          <ErrorNote message={problem} />
          <Field label="Email" htmlFor="email">
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Role" htmlFor="role">
            <Select
              id="role"
              value={role}
              onChange={(e) => setRole(e.target.value as Login["role"])}
            >
              <option value="EMPLOYEE">EMPLOYEE</option>
              <option value="HR">HR</option>
              <option value="ADMIN">ADMIN</option>
            </Select>
          </Field>
          <p className="text-xs text-zinc-500">
            A temporary password is generated and shown once. The user must
            change it at first sign-in.
          </p>
        </form>
      </Modal>
    </div>
  );
}
