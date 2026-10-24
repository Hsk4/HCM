"use client";

/**
 * @fileoverview Payroll runs: generate drafts, review payslips, finalize.
 *
 * @description
 * One page for both `/admin/payroll` and `/hr/payroll`. The split follows the
 * business rule: HR prepares drafts (which recompute from attendance, leave and
 * salary), ADMIN finalizes (which locks the month). The finalize control is only
 * rendered for ADMIN, and the API enforces the same rule if the request is
 * forged.
 *
 * @implementation
 *
 * Step 1: List runs, newest month first, with totals per run.
 * Step 2: Selecting a month loads its payslips.
 * Step 3: "Generate draft" posts `action=draft` for a chosen month.
 * Step 4: "Finalize" posts `action=finalize` and confirms first.
 * Step 5: Each payslip links to the PDF endpoint.
 * Step 6: A finalized month shows as locked and offers no draft/finalize.
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
import { ConfirmButton } from "@/components/modal";
import {
  ErrorNote,
  PageHeader,
  StateRow,
  SuccessNote,
} from "@/components/page-kit";

type Run = {
  id: string;
  month: string;
  status: "draft" | "finalized";
  finalizedAt: string | null;
};

type Slip = {
  id: string;
  code: string;
  name: string;
  lastName: string;
  basic: number;
  gross: number;
  deduction: number;
  tax: number;
  net: number;
  workingDays: number;
  absentDays: number;
  unpaidDays: number;
  halfDays: number;
};

type Detail = Run & { slips: Slip[] };

const money = (n: number) =>
  n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/**
 * Renders the payroll page.
 *
 * @param props.isAdmin Whether the caller may finalize a month.
 * @returns The payroll page content.
 */
export function PayrollRuns({ isAdmin }: { isAdmin: boolean }) {
  const [month, setMonth] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const runs = useJson<{ runs: Run[]; detail: Detail | null }>(
    selected ? `/api/payroll?month=${selected}` : "/api/payroll",
    [selected],
  );

  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const defaults = new Date().toISOString().slice(0, 7);

  async function generate() {
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try {
      await api("/api/payroll?action=draft", {
        method: "POST",
        body: JSON.stringify({ month: month || defaults }),
      });
      setSelected(month || defaults);
      setNotice(`Draft generated for ${month || defaults}.`);
      runs.reload();
    } catch (err) {
      setProblem(
        err instanceof Error ? err.message : "Could not generate draft",
      );
    } finally {
      setBusy(false);
    }
  }

  async function finalize(target: string) {
    await api("/api/payroll?action=finalize", {
      method: "POST",
      body: JSON.stringify({ month: target }),
    });
    setNotice(`${target} finalized and locked.`);
    runs.reload();
  }

  const list = runs.data?.runs ?? [];
  const detail = runs.data?.detail ?? null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Payroll"
        subtitle={
          isAdmin
            ? "Generate drafts, review payslips, then finalize to lock the month."
            : "Prepare monthly drafts. Finalizing is limited to Admin."
        }
        actions={
          <div className="flex items-end gap-2">
            <Field label="Month" htmlFor="month">
              <Input
                id="month"
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="w-40"
              />
            </Field>
            <Button size="sm" onClick={generate} disabled={busy}>
              {busy ? "Working…" : "Generate draft"}
            </Button>
          </div>
        }
      />

      <SuccessNote message={notice} />
      <ErrorNote message={problem} />

      <Card>
        <CardHeader>
          <CardTitle>Runs</CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          <Table>
            <thead>
              <tr>
                <Th>Month</Th>
                <Th>Status</Th>
                <Th>Finalized</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              <StateRow
                loading={runs.loading}
                error={runs.error}
                empty={!runs.loading && !runs.error && list.length === 0}
                emptyText="No payroll runs yet — generate a draft to start."
                colSpan={4}
              />
              {list.map((r) => (
                <tr
                  key={r.id}
                  className={
                    selected === r.month
                      ? "bg-zinc-50 dark:bg-zinc-900/60"
                      : undefined
                  }
                >
                  <Td className="font-mono font-medium">{r.month}</Td>
                  <Td>
                    {r.status === "finalized" ? (
                      <Badge tone="success">Finalized</Badge>
                    ) : (
                      <Badge tone="warning">Draft</Badge>
                    )}
                  </Td>
                  <Td className="text-xs text-zinc-500">
                    {r.finalizedAt
                      ? new Date(r.finalizedAt).toLocaleString()
                      : "—"}
                  </Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setSelected(r.month)}
                      >
                        View
                      </Button>
                      {isAdmin && r.status === "draft" && (
                        <ConfirmButton
                          label="Finalize"
                          message={`Finalizing ${r.month} locks it permanently. Payslips can no longer be regenerated.`}
                          onConfirm={() => finalize(r.month)}
                          onDone={() => runs.reload()}
                        />
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>

      {detail && (
        <Card>
          <CardHeader>
            <CardTitle>
              Payslips — {detail.month}{" "}
              {detail.status === "draft"
                ? "(draft, not visible to employees)"
                : "(finalized)"}
            </CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            <Table>
              <thead>
                <tr>
                  <Th>Code</Th>
                  <Th>Employee</Th>
                  <Th className="text-right">Basic</Th>
                  <Th className="text-right">Gross</Th>
                  <Th className="text-right">Deduction</Th>
                  <Th className="text-right">Tax</Th>
                  <Th className="text-right">Net</Th>
                  <Th>Days</Th>
                  <Th className="text-right">PDF</Th>
                </tr>
              </thead>
              <tbody>
                <StateRow
                  loading={false}
                  error={null}
                  empty={detail.slips.length === 0}
                  emptyText="No payslips in this run — generate the draft first."
                  colSpan={9}
                />
                {detail.slips.map((s) => (
                  <tr key={s.id}>
                    <Td className="font-mono text-xs">{s.code}</Td>
                    <Td className="font-medium">
                      {s.name} {s.lastName}
                    </Td>
                    <Td className="text-right font-mono text-xs">
                      {money(s.basic)}
                    </Td>
                    <Td className="text-right font-mono text-xs">
                      {money(s.gross)}
                    </Td>
                    <Td className="text-right font-mono text-xs">
                      {money(s.deduction)}
                    </Td>
                    <Td className="text-right font-mono text-xs">
                      {money(s.tax)}
                    </Td>
                    <Td className="text-right font-mono text-xs font-semibold">
                      {money(s.net)}
                    </Td>
                    <Td className="text-xs text-zinc-500">
                      {s.workingDays} days · {s.absentDays} absent ·{" "}
                      {s.unpaidDays} unpaid · {s.halfDays} half
                    </Td>
                    <Td className="text-right">
                      <a
                        href={`/api/payslips/${s.id}/pdf`}
                        className="text-sm text-sky-700 hover:underline dark:text-sky-400"
                      >
                        Download
                      </a>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
