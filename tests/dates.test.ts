import { workingDays } from "@/server/lib/dates";
import { expect, it } from "vitest";

it("skips Sat/Sun and holidays", () => {
  const d = workingDays("2026-10-26", "2026-11-01", [0, 6], new Set(["2026-10-28"]));
  expect(d).toEqual(["2026-10-26", "2026-10-27", "2026-10-29", "2026-10-30"]);
});