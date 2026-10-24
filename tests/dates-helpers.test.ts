import { describe, expect, it } from "vitest";
import {
  addDays,
  endOfMonth,
  monthKey,
  startOfMonth,
} from "@/server/lib/dates";
import { dateTable, currentMonthWindow } from "@/server/ai/prompts";

/**
 * @fileoverview Regression tests for date helpers and the AI date table.
 *
 * @description
 * `server/ai/prompts.ts` used to call `days.startOfMonth` and undeclared
 * `now`/`days` globals, which threw on the first assistant request. These tests
 * pin the helpers it now relies on, including month boundaries, so the same
 * breakage cannot come back silently.
 */

describe("month helpers", () => {
  it("extracts the month key", () => {
    expect(monthKey("2026-10-24")).toBe("2026-10");
  });

  it("finds the first and last day of a 31-day month", () => {
    expect(startOfMonth("2026-10-24")).toBe("2026-10-01");
    expect(endOfMonth("2026-10-24")).toBe("2026-10-31");
  });

  it("finds the last day of February in a leap year", () => {
    expect(endOfMonth("2028-02-10")).toBe("2028-02-29");
  });

  it("finds the last day of February in a non-leap year", () => {
    expect(endOfMonth("2026-02-10")).toBe("2026-02-28");
  });

  it("clamps to the month of the 1st", () => {
    expect(startOfMonth("2026-01-01")).toBe("2026-01-01");
    expect(endOfMonth("2026-01-01")).toBe("2026-01-31");
  });
});

describe("currentMonthWindow", () => {
  it("returns the full month plus the current day", () => {
    expect(currentMonthWindow("2026-10-24")).toEqual({
      start: "2026-10-01",
      end: "2026-10-31",
      today: "2026-10-24",
      month: "2026-10",
    });
  });
});

describe("dateTable", () => {
  const table = dateTable("2026-10-24");

  it("lists 21 consecutive days with weekday names", () => {
    const lines = table.split("\n");
    expect(lines).toHaveLength(21);
    expect(lines[0]).toBe("2026-10-24 Sat");
    // Day 20 is 20 days later — a different weekday (2026-11-13 is a Friday).
    expect(lines[20]).toBe("2026-11-13 Fri");
    expect(lines[20].slice(0, 10)).toBe(addDays("2026-10-24", 20));
  });

  it("labels weekdays correctly", () => {
    // 2026-10-26 is a Monday.
    expect(table.split("\n")[2]).toBe("2026-10-26 Mon");
  });
});
