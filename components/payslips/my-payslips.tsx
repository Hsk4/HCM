"use client";

/**
 * @fileoverview `/employee/payslips` — finalized payslips and PDF downloads.
 *
 * @description
 * Lists the caller's finalized payslips only. Drafts are intentionally withheld
 * until payroll is locked, so the figure an employee sees can no longer change.
 * Each row links to the PDF endpoint, which re-checks ownership server-side.
 *
 * @implementation
 *
 * Step 1: Load `/api/payslips`.
 * Step 2: Show month, gross, deductions, tax and net.
 * Step 3: Download links target `/api/payslips/[id]/pdf`.
 * Step 4: Empty state explains that slips appear after payroll is finalized.
 * Step 5: No client-side filtering by employee — the API scopes it.
 * Step 6: A draft slip id must not be downloadable by URL.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

import { useJson } from "@/lib/use-json";
import { Card, CardBody } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { PageHeader, StateRow } from "@/components/page-kit";

type Slip = {
  id: string;
  month: string;
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

const money = (n: number) =>
  n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/**
 * Renders the payslips page.
 *
 * @returns The payslips page content.
 */
export function MyPayslips() {
  const { data, error, loading } = useJson<{ payslips: Slip[] }>(
    "/api/payslips",
  );
  const slips = data?.payslips ?? [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Payslips"
        subtitle="Finalized payslips only — drafts become visible once payroll is locked."
      />

      <Card>
        <CardBody className="p-0">
          <Table>
            <thead>
              <tr>
                <Th>Month</Th>
                <Th className="text-right">Gross</Th>
                <Th className="text-right">Deductions</Th>
                <Th className="text-right">Tax</Th>
                <Th className="text-right">Net</Th>
                <Th>Days</Th>
                <Th className="text-right">PDF</Th>
              </tr>
            </thead>
            <tbody>
              <StateRow
                loading={loading}
                error={error}
                empty={!loading && !error && slips.length === 0}
                emptyText="No payslips yet. They appear after payroll is finalized."
                colSpan={7}
              />
              {slips.map((s) => (
                <tr key={s.id}>
                  <Td className="font-mono font-medium">{s.month}</Td>
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
    </div>
  );
}
