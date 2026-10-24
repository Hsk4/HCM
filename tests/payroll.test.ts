import { describe, it, expect } from "vitest";
import { annualTax, computePayslip, grossFromBasic } from "@/server/services/payroll.service";

describe("tax slab", () => {
  it.each([
    [500_000, 0], [600_000, 0], [1_200_000, 30_000],
    [2_400_000, 210_000], [3_600_000, 510_000], [4_000_000, 650_000],
  ])("annual %i => %i", (a, t) => expect(annualTax(a)).toBeCloseTo(t));
});

describe("payslip", () => {
  const days = Array.from({ length: 20 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
  it("gross is 1.5x basic", () => expect(grossFromBasic(100_000)).toBe(150_000));
  it("deducts absent + unpaid + half", () => {
    const st = new Map([[days[0], "absent"], [days[1], "unpaid_leave"], [days[2], "half_day"]]);
    const p = computePayslip({ basic: 100_000, hraPct: 40, medicalPct: 10, monthWorkingDays: days, statuses: st, joinDate: "2026-01-01", exitDate: null });
    expect(p.breakdown.deductDays).toBe(2.5);
    expect(p.deduction).toBeCloseTo((150_000 / 20) * 2.5);
  });
  it("prorates a mid-month joiner", () => {
    const p = computePayslip({ basic: 100_000, hraPct: 40, medicalPct: 10, monthWorkingDays: days, statuses: new Map(), joinDate: days[10], exitDate: null });
    expect(p.ineligibleDays).toBe(10);
  });
});