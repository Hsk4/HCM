/**
 * @fileoverview Payroll: payslip maths, draft generation, finalisation.
 *
 * @description
 * Money is computed once, at draft time, from three inputs: the employee's
 * salary structure, the month's working days, and the derived daily statuses
 * (present / late / half / absent / unpaid / ineligible). The result — and its
 * breakdown — is stored on the payslip so a finalized month is reproducible
 * forever, even if tax slabs or rules change later. Finalisation is ADMIN-only
 * and locks the run; re-running a draft month replaces its payslips.
 *
 * The rules, from the company policy:
 *   gross     = basic × 1.5                     (HRA 40%, medical 10%)
 *   perDay    = gross / working days
 *   deduct    = perDay × (ineligible + absent + unpaid + 0.5 × halfDays)
 *   tax       = annualTax(gross × 12) / 12
 *   net       = gross − deduct − tax
 *
 * @implementation
 *
 * Step 1: Pure maths — `annualTax`, `grossFromBasic`, `computePayslip` (no DB).
 * Step 2: `createDraft` — resolve working days + statuses, pick each employee's
 *         salary in effect, write one payslip per eligible employee.
 * Step 3: `finalize` — ADMIN only, flips the run to `finalized` and locks it.
 * Step 4: `listPayslips` — employees see only their own finalized slips.
 * Step 5: All writes are audited inside the same transaction.
 * Step 6: Verified by `tests/payroll.test.ts` (slabs, deductions, proration).
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

// ── Step 1: dependencies and pure maths ───────────────────────────────────────
import { and, eq, lte, desc } from "drizzle-orm";
import { db } from "../db";
import { employees, salaryStructures, payrollRuns, payslips } from "../db/schema";
import { SessionUser } from "../auth/session";
import { forbidden, conflict, notFound } from "../errors";
import { getSettings, holidaySet } from "./org.service";
import { resolveDailyStatuses } from "./daily-status";
import { monthRange, workingDays } from "../lib/dates";
import { audit } from "../lib/audit";

/** Rounds to 2 decimals (money). */
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Annual income tax on the yearly taxable amount, using the company slabs.
 *
 * @param annual Gross annual salary.
 * @returns Tax owed for the year.
 * @example annualTax(1_200_000) // 30_000
 */
export function annualTax(annual: number) {
  const slabs = [
    { from: 0,         upTo: 600_000,   base: 0,       rate: 0 },
    { from: 600_000,   upTo: 1_200_000, base: 0,       rate: 0.05 },
    { from: 1_200_000, upTo: 2_400_000, base: 30_000,  rate: 0.15 },
    { from: 2_400_000, upTo: 3_600_000, base: 210_000, rate: 0.25 },
    { from: 3_600_000, upTo: Infinity,  base: 510_000, rate: 0.35 },
  ];
  const s = slabs.find((x) => annual <= x.upTo)!;
  return s.base + (annual - s.from) * s.rate;
}

/**
 * Monthly gross from basic salary.
 *
 * @param basic      Monthly basic.
 * @param hraPct     House-rent allowance percentage (default 40).
 * @param medicalPct Medical allowance percentage (default 10).
 * @returns `basic × (1 + hraPct/100 + medicalPct/100)`.
 */
export function grossFromBasic(basic: number, hraPct = 40, medicalPct = 10) {
  return basic * (1 + hraPct / 100 + medicalPct / 100);
}

/** Inputs for one payslip calculation. */
export type PayslipInput = {
  basic: number; hraPct: number; medicalPct: number;
  /** All working days of the month (strings, ascending). */
  monthWorkingDays: string[];
  /** Derived status per working day for this employee. */
  statuses: Map<string, string>;
  joinDate: string; exitDate: string | null;
};

/**
 * Computes one payslip. Pure function — no database access.
 *
 * @param i Salary, month days, daily statuses and employment dates.
 * @returns Stored payslip fields: amounts, day counts and a breakdown object.
 */
export function computePayslip(i: PayslipInput) {
  const gross = grossFromBasic(i.basic, i.hraPct, i.medicalPct);
  const total = i.monthWorkingDays.length || 1; // never divide by zero
  const perDay = gross / total;

  let absent = 0, unpaid = 0, half = 0, ineligible = 0;
  for (const d of i.monthWorkingDays) {
    // Days before joining or after leaving are unpaid by proration, not absence.
    if (d < i.joinDate || (i.exitDate && d > i.exitDate)) { ineligible++; continue; }
    const st = i.statuses.get(d);
    if (st === "absent") absent++;
    else if (st === "unpaid_leave") unpaid++;
    else if (st === "half_day") half++;
  }

  const deductDays = ineligible + absent + unpaid + 0.5 * half;
  const deduction = Math.min(gross, perDay * deductDays); // never deduct more than gross
  const tax = annualTax(gross * 12) / 12;
  const net = gross - deduction - tax;

  return {
    basic: r2(i.basic), gross: r2(gross), workingDays: total,
    absentDays: absent, unpaidDays: unpaid, halfDays: half, ineligibleDays: ineligible,
    deduction: r2(deduction), tax: r2(tax), net: r2(net),
    breakdown: {
      hra: r2(i.basic * i.hraPct / 100), medical: r2(i.basic * i.medicalPct / 100),
      perDay: r2(perDay), deductDays,
    },
  };
}

// ── Step 2: draft generation ──────────────────────────────────────────────────

/**
 * Creates or regenerates the payroll draft for a month.
 *
 * @param user  The HR user preparing payroll.
 * @param month Month key `YYYY-MM`.
 * @returns The payroll run row.
 * @throws 403 for non-HR; 409 when the month is already finalized.
 */
export async function createDraft(user: SessionUser, month: string) {
  if (user.role !== "HR") throw forbidden("Only HR prepares payroll");
  const { start, end } = monthRange(month);
  const s = await getSettings();
  const mDays = workingDays(start, end, s.weekendDays, await holidaySet(start, end));

  return db.transaction(async (tx) => {
    let [run] = await tx.select().from(payrollRuns).where(eq(payrollRuns.month, month));
    if (run?.status === "finalized") throw conflict("This month is finalized and locked");
    if (!run) [run] = await tx.insert(payrollRuns).values({ month, preparedBy: user.id }).returning();
    else await tx.delete(payslips).where(eq(payslips.runId, run.id)); // regenerate

    // Everyone employed at any point in the month; joiners/leavers are prorated
    // inside `computePayslip` via `ineligibleDays`.
    const emps = await tx.select().from(employees).where(
      and(lte(employees.joinDate, end)));
    const active = emps.filter((e) => !e.exitDate || e.exitDate >= start);
    const ids = active.map((e) => e.id);
    const { byEmployee } = await resolveDailyStatuses(ids, start, end);

    for (const e of active) {
      // Salary structure in effect at the end of the month.
      const [sal] = await tx.select().from(salaryStructures)
        .where(and(eq(salaryStructures.employeeId, e.id), lte(salaryStructures.effectiveFrom, end)))
        .orderBy(desc(salaryStructures.effectiveFrom)).limit(1);
      if (!sal) continue; // no salary on file → no slip (reported by the UI)
      const slip = computePayslip({
        basic: sal.basic, hraPct: sal.hraPct, medicalPct: sal.medicalPct,
        monthWorkingDays: mDays, statuses: byEmployee.get(e.id)!, joinDate: e.joinDate, exitDate: e.exitDate,
      });
      await tx.insert(payslips).values({ runId: run.id, employeeId: e.id, ...slip });
    }
    await audit(tx, user, "payroll.draft", "payroll_run", run.id, null, { month });
    return run;
  });
}

// ── Step 3: finalisation ─────────────────────────────────────────────────────

/**
 * Finalises and locks a month's payroll (ADMIN only).
 *
 * @param user  The admin finalising payroll.
 * @param month Month key `YYYY-MM`.
 * @returns The finalized run row.
 * @throws 403 for non-admin; 404 when no draft exists; 409 when already final.
 */
export async function finalize(user: SessionUser, month: string) {
  if (user.role !== "ADMIN") throw forbidden("Only Admin can finalize payroll");
  return db.transaction(async (tx) => {
    const [run] = await tx.select().from(payrollRuns).where(eq(payrollRuns.month, month));
    if (!run) throw notFound("No payroll draft for this month");
    if (run.status === "finalized") throw conflict("Already finalized");
    const [after] = await tx.update(payrollRuns)
      .set({ status: "finalized", finalizedBy: user.id, finalizedAt: new Date() })
      .where(eq(payrollRuns.id, run.id)).returning();
    await audit(tx, user, "payroll.finalize", "payroll_run", run.id, run, after);
    return after;
  });
}

// ── Step 4: read side ────────────────────────────────────────────────────────

/**
 * Lists payslips visible to the caller.
 *
 * @param user The caller; employees get only their own finalized slips.
 * @returns Rows of `{ slip, month, status }`.
 * @note Returns the query builder, so routes can add filters before awaiting.
 */
export async function listPayslips(user: SessionUser) {
  const q = db.select({ slip: payslips, month: payrollRuns.month, status: payrollRuns.status })
    .from(payslips).innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId));
  if (user.role === "EMPLOYEE")
    return q.where(and(eq(payslips.employeeId, user.employeeId!), eq(payrollRuns.status, "finalized")));
  return q;
}
