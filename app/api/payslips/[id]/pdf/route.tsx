/**
 * @fileoverview Payslip PDF generation.
 *
 * @description
 * Renders one payslip as an A4 PDF. Employees may download only their **own
 * finalized** slips; HR/Admin may download any slip. The figures come straight
 * from the stored payslip row — never recomputed — so the PDF always matches
 * what payroll finalised, even if tax rules change later.
 *
 * @implementation
 *
 * Step 1: Authenticate (any role).
 * Step 2: Load the payslip with its run month/status and employee.
 * Step 3: Enforce ownership + finalized status for employees.
 * Step 4: Build the line items and render with `@react-pdf/renderer`.
 * Step 5: Return the buffer as an attachment download.
 * Step 6: An employee requesting another employee's slip must get 403; an
 *         unknown id 404. No `runtime` export — Cache Components requires Node,
 *         and the package is in `serverExternalPackages` in next.config.ts.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

import { renderToBuffer, Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { eq } from "drizzle-orm";
import { withAuth } from "@/server/auth/guard";
import { db } from "@/server/db";
import { payslips, payrollRuns, employees } from "@/server/db/schema";
import { forbidden, notFound } from "@/server/errors";

// Note: no `runtime` segment config — Cache Components requires the Node runtime
// and rejects `export const runtime` anywhere in the app (see next.config.ts).

/** Print styles: one page, heading and label/value rows. */
const st = StyleSheet.create({
  page: { padding: 32, fontSize: 11 },
  h1: { fontSize: 18, marginBottom: 12 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, borderBottom: "1 solid #eee" },
});

/**
 * Streams one payslip as a PDF attachment.
 *
 * @param ctx Route params — `id` is the payslip id.
 * @returns `application/pdf` with an attachment filename.
 * @throws 404 when unknown; 403 when an employee asks for someone else's slip
 *         or for a slip from a run that is not finalized.
 */
export const GET = withAuth(["ADMIN", "HR", "EMPLOYEE"], async (_req, ctx, user) => {
  const { id } = await ctx.params;
  const [row] = await db.select({ s: payslips, m: payrollRuns.month, st: payrollRuns.status, e: employees })
    .from(payslips)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId))
    .innerJoin(employees, eq(employees.id, payslips.employeeId))
    .where(eq(payslips.id, id));
  if (!row) throw notFound();
  if (user.role === "EMPLOYEE" && (row.s.employeeId !== user.employeeId || row.st !== "finalized")) throw forbidden();

  const lines: [string, string][] = [
    ["Basic", row.s.basic.toFixed(2)], ["Gross", row.s.gross.toFixed(2)],
    ["Working days", String(row.s.workingDays)], ["Absent days", String(row.s.absentDays)],
    ["Unpaid leave days", String(row.s.unpaidDays)], ["Half days", String(row.s.halfDays)],
    ["Deductions", row.s.deduction.toFixed(2)], ["Tax", row.s.tax.toFixed(2)], ["Net pay", row.s.net.toFixed(2)],
  ];
  const buf = await renderToBuffer(
    <Document><Page size="A4" style={st.page}>
      <Text style={st.h1}>Payslip — {row.m}</Text>
      <Text>{row.e.firstName} {row.e.lastName} ({row.e.code})</Text>
      <View style={{ marginTop: 12 }}>
        {lines.map(([k, v]) => <View key={k} style={st.row}><Text>{k}</Text><Text>{v}</Text></View>)}
      </View>
    </Page></Document>,
  );
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="payslip-${row.m}.pdf"` },
  });
});