"use client";

/**
 * @fileoverview `/employee/leave` — balances, request form, own history.
 *
 * @description
 * Leaves the rules on the server (working days, overlap, quota) and shows their
 * outcome: the form only collects type and dates, and any rejection is rendered
 * from the API's 422 message. Balances count approved *and* pending days, so the
 * number shown here is the same one the validator uses.
 *
 * @implementation
 *
 * Step 1: Load balance, available types and existing requests in one call.
 * Step 2: Show a balance card per leave type (unlimited types have no quota).
 * Step 3: Request form: type, start, end, reason.
 * Step 4: Validation errors (overlap, insufficient balance) show inline.
 * Step 5: Cancel is offered for pending/approved requests.
 * Step 6: After submitting, balance and history refresh.
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
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { ConfirmButton } from "@/components/modal";
import {
  ErrorNote,
  PageHeader,
  StateRow,
  SuccessNote,
} from "@/components/page-kit";

type Balance = {
  type: string;
  quota: number | null;
  used: number;
  remaining: number | null;
};
type LeaveType = {
  id: string;
  code: string;
  name: string;
  yearlyQuota: number | null;
  isPaid: boolean;
};
type Request = {
  id: string;
  type: string;
  start: string;
  end: string;
  days: number;
  status: string;
  reason: string | null;
};
type Payload = { balance: Balance[]; types: LeaveType[]; requests: Request[] };

const TONE: Record<string, "warning" | "success" | "danger" | "neutral"> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  cancelled: "neutral",
};

/**
 * Renders the employee leave page.
 *
 * @returns The leave page content.
 */
export function MyLeave() {
  const { data, error, loading, reload } = useJson<Payload>("/api/leave");
  const [form, setForm] = useState({
    type: "annual",
    start: "",
    end: "",
    reason: "",
  });
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try {
      await api("/api/leave", {
        method: "POST",
        body: JSON.stringify({
          type: form.type,
          start: form.start,
          end: form.end,
          reason: form.reason || undefined,
        }),
      });
      setNotice("Leave request submitted for approval.");
      setForm({ ...form, start: "", end: "", reason: "" });
      reload();
    } catch (err) {
      setProblem(
        err instanceof Error ? err.message : "Could not submit request",
      );
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    await api(`/api/leave/${id}`, { method: "DELETE" });
    setNotice("Request cancelled.");
    reload();
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Leave"
        subtitle="Request time off and track what you have left."
      />

      <SuccessNote message={notice} />
      <ErrorNote message={problem} />

      {data && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {data.balance.map((b) => (
            <Card key={b.type}>
              <CardBody>
                <p className="text-xs uppercase tracking-wide text-zinc-500">
                  {b.type}
                </p>
                <p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                  {b.remaining ?? "∞"}
                  {b.quota != null && (
                    <span className="ml-1 text-sm font-normal text-zinc-500">
                      / {b.quota}
                    </span>
                  )}
                </p>
                <p className="text-xs text-zinc-500">
                  {b.used} used (incl. pending)
                </p>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>New request</CardTitle>
        </CardHeader>
        <CardBody>
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-4">
            <Field label="Type" htmlFor="type">
              <Select
                id="type"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                {(data?.types ?? []).map((t) => (
                  <option key={t.id} value={t.code}>
                    {t.name}
                    {t.yearlyQuota != null ? ` (${t.yearlyQuota}/yr)` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="From" htmlFor="start">
              <Input
                id="start"
                type="date"
                required
                value={form.start}
                onChange={(e) => setForm({ ...form, start: e.target.value })}
              />
            </Field>
            <Field label="To" htmlFor="end">
              <Input
                id="end"
                type="date"
                required
                value={form.end}
                onChange={(e) => setForm({ ...form, end: e.target.value })}
              />
            </Field>
            <div className="flex items-end">
              <Button size="sm" type="submit" disabled={busy}>
                {busy ? "Submitting…" : "Submit"}
              </Button>
            </div>
            <div className="sm:col-span-4">
              <Field label="Reason (optional)" htmlFor="reason">
                <Textarea
                  id="reason"
                  rows={2}
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                />
              </Field>
            </div>
            <p className="text-xs text-zinc-500 sm:col-span-4">
              Only working days count. Weekends, public holidays, overlaps and
              balances are checked on submit.
            </p>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>My requests</CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          <Table>
            <thead>
              <tr>
                <Th>Type</Th>
                <Th>Dates</Th>
                <Th>Days</Th>
                <Th>Status</Th>
                <Th>Reason</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              <StateRow
                loading={loading}
                error={error}
                empty={!loading && !error && (data?.requests.length ?? 0) === 0}
                emptyText="No leave requests yet."
                colSpan={6}
              />
              {data?.requests.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <Badge tone="info">{r.type}</Badge>
                  </Td>
                  <Td className="font-mono text-xs">
                    {r.start} → {r.end}
                  </Td>
                  <Td>{r.days}</Td>
                  <Td>
                    <Badge tone={TONE[r.status] ?? "neutral"}>{r.status}</Badge>
                  </Td>
                  <Td className="max-w-[18rem] truncate text-sm text-zinc-600 dark:text-zinc-400">
                    {r.reason || "—"}
                  </Td>
                  <Td className="text-right">
                    {(r.status === "pending" || r.status === "approved") && (
                      <ConfirmButton
                        label="Cancel"
                        message="Cancel this leave request?"
                        onConfirm={() => cancel(r.id)}
                        onDone={() => setNotice("Request cancelled.")}
                      />
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>
    </div>
  );
}
