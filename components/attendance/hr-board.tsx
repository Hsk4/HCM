"use client";

/**
 * @fileoverview HR attendance board and correction queue.
 *
 * @description
 * Two related panels on one page:
 *
 *  1. **Day board** — every active employee's status for a chosen date, from
 *     `resolveDailyStatuses`, so it matches the dashboard and payroll exactly.
 *  2. **Corrections** — employees who forgot to check in/out file a request;
 *     HR approves (which writes the times onto the attendance row) or rejects.
 *
 * @implementation
 *
 * Step 1: Board defaults to today; the date input reloads it.
 * Step 2: Optional department filter.
 * Step 3: Statuses render as badges with the same vocabulary as payroll.
 * Step 4: Corrections load separately and refresh after each decision.
 * Step 5: Approving refreshes both panels (the board's times change).
 * Step 6: An already-decided request returns 422 and shows inline.
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
import { Field, Input, Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import {
  ErrorNote,
  PageHeader,
  StateRow,
  SuccessNote,
} from "@/components/page-kit";

type BoardRow = {
  employeeId: string;
  code: string;
  name: string;
  department: string;
  status: string | null;
  checkIn: string | null;
  checkOut: string | null;
  workedMinutes: number | null;
  isLate: boolean;
};

type Correction = {
  id: string;
  employeeId: string;
  date: string;
  requestedCheckIn: string | null;
  requestedCheckOut: string | null;
  reason: string;
};

type Dept = { id: string; name: string };

const TONE: Record<
  string,
  "success" | "warning" | "danger" | "neutral" | "info"
> = {
  present: "success",
  late: "warning",
  half_day: "info",
  missing_checkout: "warning",
  absent: "danger",
  on_leave: "info",
  unpaid_leave: "neutral",
};

/** Formats an ISO timestamp as local `HH:MM`. */
function hhmm(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Renders the attendance board and correction queue.
 *
 * @returns The HR attendance page content.
 */
export function HrAttendanceBoard() {
  const [date, setDate] = useState("");
  const [departmentId, setDepartmentId] = useState("");

  const params = new URLSearchParams({ scope: "board" });
  if (date) params.set("date", date);
  if (departmentId) params.set("departmentId", departmentId);

  const board = useJson<{ rows: BoardRow[] }>(`/api/attendance?${params}`, [
    date,
    departmentId,
  ]);
  const corrections = useJson<{ requests: Correction[] }>(
    "/api/attendance/corrections",
  );
  const depts = useJson<Dept[]>("/api/org?type=department");

  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function decide(id: string, approve: boolean) {
    setProblem(null);
    setNotice(null);
    try {
      await api(`/api/attendance/corrections/${id}`, {
        method: "POST",
        body: JSON.stringify({ approve }),
      });
      setNotice(
        approve ? "Correction approved and applied." : "Correction rejected.",
      );
      corrections.reload();
      board.reload();
    } catch (err) {
      setProblem(
        err instanceof Error ? err.message : "Could not save decision",
      );
    }
  }

  const rows = board.data?.rows ?? [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Attendance board"
        subtitle="Daily status for every active employee."
      />

      <SuccessNote message={notice} />
      <ErrorNote message={problem} />

      <div className="flex flex-wrap items-end gap-2">
        <Field label="Date" hint="Blank = today" htmlFor="date">
          <Input
            id="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-40"
          />
        </Field>
        <Field label="Department" htmlFor="dept">
          <Select
            id="dept"
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
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
      </div>

      <Card>
        <CardBody className="p-0">
          <Table>
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Employee</Th>
                <Th>Department</Th>
                <Th>Status</Th>
                <Th>In</Th>
                <Th>Out</Th>
                <Th>Worked</Th>
              </tr>
            </thead>
            <tbody>
              <StateRow
                loading={board.loading}
                error={board.error}
                empty={!board.loading && !board.error && rows.length === 0}
                emptyText="No active employees in this view."
                colSpan={7}
              />
              {rows.map((r) => (
                <tr key={r.employeeId}>
                  <Td className="font-mono text-xs">{r.code}</Td>
                  <Td className="font-medium">{r.name}</Td>
                  <Td>{r.department}</Td>
                  <Td>
                    {r.status ? (
                      <Badge tone={TONE[r.status] ?? "neutral"}>
                        {r.status}
                      </Badge>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </Td>
                  <Td className="font-mono text-xs">{hhmm(r.checkIn)}</Td>
                  <Td className="font-mono text-xs">{hhmm(r.checkOut)}</Td>
                  <Td className="font-mono text-xs">
                    {r.workedMinutes == null ? "—" : `${r.workedMinutes} min`}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pending corrections</CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Requested in</Th>
                <Th>Requested out</Th>
                <Th>Reason</Th>
                <Th className="text-right">Decision</Th>
              </tr>
            </thead>
            <tbody>
              <StateRow
                loading={corrections.loading}
                error={corrections.error}
                empty={
                  !corrections.loading &&
                  !corrections.error &&
                  (corrections.data?.requests.length ?? 0) === 0
                }
                emptyText="No pending corrections."
                colSpan={5}
              />
              {corrections.data?.requests.map((c) => (
                <tr key={c.id}>
                  <Td className="font-mono text-xs">{c.date}</Td>
                  <Td className="font-mono text-xs">
                    {c.requestedCheckIn ?? "—"}
                  </Td>
                  <Td className="font-mono text-xs">
                    {c.requestedCheckOut ?? "—"}
                  </Td>
                  <Td className="max-w-xs truncate">{c.reason}</Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" onClick={() => decide(c.id, true)}>
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => decide(c.id, false)}
                      >
                        Reject
                      </Button>
                    </div>
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
