/**
 * @fileoverview Company settings and holiday calendar.
 *
 * @description
 * `settings` is a single-row table (`id = 1`) holding office hours, grace,
 * half-day threshold, weekend days, geofence and timezone. Almost every rule in
 * the app (lateness, working days, payroll) is derived from it, so it is read
 * through one function that fails clearly when the app has not been set up.
 *
 * @implementation
 *
 * Step 1: `getSettings` loads the singleton row.
 * Step 2: If the row is missing, throw `409 SETUP_REQUIRED` so the UI can send
 *         the operator to `/setup` instead of showing a confusing empty state.
 * Step 3: `holidaySet` loads holidays inside a range for working-day maths.
 * Step 4: Both are read-only and safe to call repeatedly.
 * Step 5: Consumed by attendance, leave, payroll, daily-status and AI prompts.
 * Step 6: A fresh database must yield `SETUP_REQUIRED`, never `undefined`.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

// ── Step 1: dependencies ──────────────────────────────────────────────────────
import { between, eq } from "drizzle-orm";
import { db } from "../db";
import { settings, holidays } from "../db/schema";
import { AppError } from "../errors";

/**
 * Loads the company settings singleton.
 *
 * @returns The settings row.
 * @throws {AppError} 409 `SETUP_REQUIRED` when first-run setup has not completed.
 */
export async function getSettings() {
  const [s] = await db.select().from(settings).where(eq(settings.id, 1));
  if (!s) throw new AppError(409, "SETUP_REQUIRED", "Run first-time setup");
  return s;
}

/**
 * Lists public holidays within a date range.
 *
 * @param from Start `YYYY-MM-DD` (inclusive).
 * @param to   End `YYYY-MM-DD` (inclusive).
 * @returns A set of holiday dates, for O(1) lookups in `workingDays`.
 */
export async function holidaySet(from: string, to: string) {
  const rows = await db.select({ date: holidays.date }).from(holidays).where(between(holidays.date, from, to));
  return new Set(rows.map((r) => r.date));
}
