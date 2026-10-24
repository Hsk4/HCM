"use client";

/**
 * @fileoverview HR leave approval queue.
 *
 * @description
 * Lists leave requests by status (pending by default) and lets HR approve or
 * reject with an optional comment. Approval is the event that makes the days
 * count as `on_leave` in attendance and reduces the requester's balance, so the
 * page refreshes the list after every decision rather than optimistically
 * assuming success.
 *
 * @implementation
 *
 * Step 1: Status tabs: pending, approved, rejected, all.
 * Step 2: Table shows employee, type, dates, computed days and reason.
 * Step 3: Approve/reject post to `/api/leave/requests/[id]`.
 * Step 4: A decision comment can be entered before deciding.
 * Step 5: Errors (e.g. "not pending") show inline.
 * Step 6: Decided requests disappear from the pending tab.
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
import { Input } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import {
  ErrorNote,
  PageHeader,
  StateRow,
  SuccessNote,
} from "@/components/page-kit";

type Status = "pending" | "approved" | "rejected" | "all";

type Request = {
  id: string;
  code: string;
  name: string;
  lastName: string;
  type: string;
  start: string;
  end: string;
  days: number;
  reason: string | null;
  status: string;
  decisionComment: string | null;
};

const TABS: { key: Status; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "all", label: "All" },
];

const TONE: Record<string, "warning" | "success" | "danger" | "neutral"> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  cancelled: "neutral",
};

/**
 * Renders the HR leave queue.
 *
 * @returns The leave approvals page content.
 */
export function HrLeaveApprovals() {
  const [status, setStatus] = useState<Status>("pending");
  const { data, error, loading, reload } = useJson<{ requests: Request[] }>(
    `/api/leave/requests?status=${status}`,
    [status],
  );

  const [comments, setComments] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function decide(id: string, approve: boolean) {
    setBusy(id);
    setProblem(null);
    setNotice(null);
    try {
      await api(`/api/leave/requests/${id}`, {
        method: "POST",
        body: JSON.stringify({ approve, comment: comments[id] ?? "" }),
      });
      setNotice(approve ? "Request approved." : "Request rejected.");
      reload();
    } catch (err) {
      setProblem(
        err instanceof Error ? err.message : "Could not save decision",
      );
    } finally {
      setBusy(null);
    }
  }

  const requests = data?.requests ?? [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Leave approvals"
        subtitle="Approve or reject leave requests for the company."
      />

      <SuccessNote message={notice} />
      <ErrorNote message={problem} />

      <div className="flex flex-wrap gap-1" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={status === t.key}
            onClick={() => {
              setStatus(t.key);
              setNotice(null);
            }}
            className={`rounded-md px-3 py-1.5 text-sm ${
              status === t.key
                ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card>
        <CardBody className="p-0">
          <Table>
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>Type</Th>
                <Th>Dates</Th>
                <Th>Days</Th>
                <Th>Reason</Th>
                <Th>Status</Th>
                <Th className="text-right">Decision</Th>
              </tr>
            </thead>
            <tbody>
              <StateRow
                loading={loading}
                error={error}
                empty={!loading && !error && requests.length === 0}
                emptyText={
                  status === "pending"
                    ? "Nothing waiting for approval."
                    : "No requests in this view."
                }
                colSpan={7}
              />
              {requests.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <span className="font-mono text-xs text-zinc-500">
                      {r.code}
                    </span>{" "}
                    <span className="font-medium">
                      {r.name} {r.lastName}
                    </span>
                  </Td>
                  <Td>
                    <Badge tone="info">{r.type}</Badge>
                  </Td>
                  <Td className="font-mono text-xs">
                    {r.start} → {r.end}
                  </Td>
                  <Td>{r.days}</Td>
                  <Td className="max-w-[16rem]">
                    <span className="line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">
                      {r.reason || "—"}
                    </span>
                  </Td>
                  <Td>
                    <Badge tone={TONE[r.status] ?? "neutral"}>{r.status}</Badge>
                  </Td>
                  <Td className="text-right">
                    {r.status === "pending" ? (
                      <div className="flex flex-col items-end gap-1">
                        <Input
                          aria-label={`Comment for ${r.name}`}
                          placeholder="Comment (optional)"
                          value={comments[r.id] ?? ""}
                          onChange={(e) =>
                            setComments({ ...comments, [r.id]: e.target.value })
                          }
                          className="w-44 py-1 text-xs"
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            disabled={busy === r.id}
                            onClick={() => decide(r.id, true)}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy === r.id}
                            onClick={() => decide(r.id, false)}
                          >
                            Reject
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-zinc-500">
                        {r.decisionComment || "—"}
                      </span>
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
