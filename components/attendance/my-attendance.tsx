"use client";

/**
 * @fileoverview Employee attendance: check in/out, history, corrections.
 *
 * @description
 * The employee-facing attendance screen. It shows today's state (checked in?
 * checked out?) with the actions that are valid *right now*, this month's
 * per-day history, and a form to request a correction for a day they missed.
 *
 * Lateness and half-day status are decided server-side against company office
 * time — the client sends only an optional geolocation, never a timestamp.
 *
 * @implementation
 *
 * Step 1: Load the caller's history (defaults to this month).
 * Step 2: Derive today's row from the history to decide which button to show.
 * Step 3: Check-out is only offered when today's row has a check-in and no
 *         check-out; check-in only when there is no row.
 * Step 4: Correct request form: date + requested times + reason.
 * Step 5: Every action reloads so the view reflects the server's truth.
 * Step 6: A duplicate check-in returns 409 and shows inline.
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
import { Field, Input } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import {
  ErrorNote,
  PageHeader,
  StateRow,
  SuccessNote,
} from "@/components/page-kit";

type DayStatus =
  | "present"
  | "late"
  | "half_day"
  | "missing_checkout"
  | "absent"
  | "on_leave"
  | "unpaid_leave";

type History = {
  rows: {
    id: string;
    date: string;
    checkIn: string;
    checkOut: string | null;
    workedMinutes: number | null;
    isLate: boolean;
  }[];
  days: { date: string; status: DayStatus | null }[];
  summary: Record<DayStatus, number>;
};

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

/**
 * Renders the employee attendance page.
 *
 * @returns The attendance page content.
 */
export function MyAttendance() {
  const { data, error, loading, reload } = useJson<History>("/api/attendance");
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCorrection, setShowCorrection] = useState(false);

  const [correction, setCorrection] = useState({
    date: new Date().toISOString().slice(0, 10),
    requestedCheckIn: "",
    requestedCheckOut: "",
    reason: "",
  });

  const today = new Date().toISOString().slice(0, 10);
  const todayRow = data?.rows.find((r) => r.date === today);
  const canCheckIn = !todayRow;
  const canCheckOut = Boolean(todayRow && !todayRow.checkOut);

  async function punch(action: "in" | "out") {
    setBusy(true);
    setProblem(null);
    setNotice(null);

    // Geolocation is best-effort: a denied prompt must not block attendance.
    const geo = await new Promise<Record<string, number>>((resolve) => {
      if (!navigator.geolocation) return resolve({});
      navigator.geolocation.getCurrentPosition(
        (p) =>
          resolve({
            lat: p.coords.latitude,
            lng: p.coords.longitude,
            accuracy: p.coords.accuracy,
          }),
        () => resolve({}),
        { timeout: 4000 },
      );
    });

    try {
      await api(`/api/attendance?action=${action}`, {
        method: "POST",
        body: JSON.stringify(geo),
      });
      setNotice(action === "in" ? "Checked in." : "Checked out.");
      reload();
    } catch (err) {
      setProblem(
        err instanceof Error ? err.message : "Could not record attendance",
      );
    } finally {
      setBusy(false);
    }
  }

  async function fileCorrection(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      await api("/api/attendance/corrections", {
        method: "POST",
        body: JSON.stringify({
          date: correction.date,
          requestedCheckIn: correction.requestedCheckIn || undefined,
          requestedCheckOut: correction.requestedCheckOut || undefined,
          reason: correction.reason,
        }),
      });
      setNotice("Correction request sent to HR.");
      setShowCorrection(false);
      setCorrection({
        ...correction,
        requestedCheckIn: "",
        requestedCheckOut: "",
        reason: "",
      });
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Could not send request");
    } finally {
      setBusy(false);
    }
  }

  const summary = data?.summary;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Attendance"
        subtitle="Check in and out, and review your month."
        actions={
          <>
            <Button
              size="sm"
              onClick={() => punch("in")}
              disabled={busy || !canCheckIn}
            >
              Check in
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => punch("out")}
              disabled={busy || !canCheckOut}
            >
              Check out
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowCorrection((v) => !v)}
            >
              Request correction
            </Button>
          </>
        }
      />

      <SuccessNote message={notice} />
      <ErrorNote message={problem} />

      {todayRow && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Today: checked in at{" "}
          <span className="font-mono">
            {new Date(todayRow.checkIn).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          {todayRow.checkOut
            ? ` · checked out at ${new Date(todayRow.checkOut).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
            : " · not checked out yet"}
          {todayRow.isLate && (
            <Badge tone="warning" className="ml-2">
              late
            </Badge>
          )}
        </p>
      )}

      {showCorrection && (
        <Card>
          <CardHeader>
            <CardTitle>Request a correction</CardTitle>
          </CardHeader>
          <CardBody>
            <form
              onSubmit={fileCorrection}
              className="grid gap-3 sm:grid-cols-3"
            >
              <Field label="Date" htmlFor="cDate">
                <Input
                  id="cDate"
                  type="date"
                  required
                  value={correction.date}
                  onChange={(e) =>
                    setCorrection({ ...correction, date: e.target.value })
                  }
                />
              </Field>
              <Field label="Check-in" hint="HH:MM" htmlFor="cIn">
                <Input
                  id="cIn"
                  type="time"
                  value={correction.requestedCheckIn}
                  onChange={(e) =>
                    setCorrection({
                      ...correction,
                      requestedCheckIn: e.target.value,
                    })
                  }
                />
              </Field>
              <Field label="Check-out" hint="HH:MM" htmlFor="cOut">
                <Input
                  id="cOut"
                  type="time"
                  value={correction.requestedCheckOut}
                  onChange={(e) =>
                    setCorrection({
                      ...correction,
                      requestedCheckOut: e.target.value,
                    })
                  }
                />
              </Field>
              <div className="sm:col-span-3">
                <Field label="Reason" htmlFor="cReason">
                  <Input
                    id="cReason"
                    required
                    minLength={3}
                    value={correction.reason}
                    onChange={(e) =>
                      setCorrection({ ...correction, reason: e.target.value })
                    }
                    placeholder="Forgot to check out before leaving"
                  />
                </Field>
              </div>
              <div className="sm:col-span-3">
                <Button size="sm" type="submit" disabled={busy}>
                  Send to HR
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      {summary && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(summary)
            .filter(([, n]) => n > 0)
            .map(([status, n]) => (
              <Badge key={status} tone={TONE[status] ?? "neutral"}>
                {status.replace("_", " ")}: {n}
              </Badge>
            ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>This month</CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Status</Th>
                <Th>In</Th>
                <Th>Out</Th>
                <Th>Worked</Th>
              </tr>
            </thead>
            <tbody>
              <StateRow
                loading={loading}
                error={error}
                empty={!loading && !error && (data?.days.length ?? 0) === 0}
                emptyText="No working days recorded yet this month."
                colSpan={5}
              />
              {data?.days.map((d) => {
                const rec = data.rows.find((r) => r.date === d.date);
                return (
                  <tr key={d.date}>
                    <Td className="font-mono text-xs">{d.date}</Td>
                    <Td>
                      {d.status ? (
                        <Badge tone={TONE[d.status] ?? "neutral"}>
                          {d.status.replace("_", " ")}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td className="font-mono text-xs">
                      {rec
                        ? new Date(rec.checkIn).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—"}
                    </Td>
                    <Td className="font-mono text-xs">
                      {rec?.checkOut
                        ? new Date(rec.checkOut).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—"}
                    </Td>
                    <Td className="font-mono text-xs">
                      {rec?.workedMinutes == null
                        ? "—"
                        : `${rec.workedMinutes} min`}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </CardBody>
      </Card>
    </div>
  );
}
