/**
 * @fileoverview Date arithmetic for attendance, leave and payroll.
 *
 * @description
 * All "business dates" in this app are plain `YYYY-MM-DD` strings — never
 * `Date` objects — because they represent a calendar day in the *company*
 * timezone, not an instant. Keeping them as strings avoids the classic
 * off-by-one-day bug when a UTC or local timestamp is formatted near midnight.
 * Timestamps that are real instants (`checkIn`, `createdAt`) stay `Date`s.
 *
 * @implementation
 *
 * Step 1: Parse/format primitives
 *  - `toISO` / `parseISO` convert between a `Date` (treated as UTC) and the
 *    `YYYY-MM-DD` business-date string.
 *
 * Step 2: Calendar helpers
 *  - `weekday`, `addDays`, `eachDay` walk calendar days without timezone drift.
 *  - `monthRange`, `monthKey`, `startOfMonth`, `endOfMonth` derive month
 *    boundaries used by filters, payroll runs and the AI date table.
 *
 * Step 3: "Now" in the company zone
 *  - `nowIn(tz)` returns the local date *and* minute-of-day, so lateness and
 *    half-day rules are evaluated against office time, not server time.
 *
 * Step 4: Working-day calculation
 *  - `workingDays` excludes weekend indexes and public holidays.
 *
 * Step 5: Integration
 *  - Consumed by `services/leave.service.ts`, `services/payroll.service.ts`,
 *    `services/daily-status.ts` and `ai/prompts.ts`.
 *
 * Step 6: Verification
 *  - Covered by `tests/dates.test.ts` and `tests/dates-helpers.test.ts`
 *    (weekends, holidays, leap Feb, month boundaries, weekday labels).
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

// ── Step 1: parse / format primitives ─────────────────────────────────────────

/** Formats a `Date` as a `YYYY-MM-DD` string using its UTC fields. */
export const toISO = (d: Date) => d.toISOString().slice(0, 10);

/** Parses `YYYY-MM-DD` into a `Date` at 00:00 UTC. */
export const parseISO = (s: string) => new Date(`${s}T00:00:00Z`);

/** Day of week for a `YYYY-MM-DD` string: 0 = Sunday … 6 = Saturday. */
export const weekday = (s: string) => parseISO(s).getUTCDay();

// ── Step 2: calendar helpers ──────────────────────────────────────────────────

/**
 * Adds `n` calendar days to a business date.
 *
 * @param s A `YYYY-MM-DD` date string.
 * @param n Days to add (may be negative).
 * @returns The resulting `YYYY-MM-DD` string.
 */
export function addDays(s: string, n: number) {
  const d = parseISO(s);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
}

/**
 * Lists every calendar day from `from` to `to`, inclusive.
 *
 * @param from Start `YYYY-MM-DD`.
 * @param to   End `YYYY-MM-DD`.
 * @returns Array of `YYYY-MM-DD` strings in ascending order.
 */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * First and last calendar day of a month.
 *
 * @param month Month key `YYYY-MM`.
 * @returns `{ start, end }` as `YYYY-MM-DD` strings.
 */
export const monthRange = (month: string) => {
  const start = `${month}-01`;
  const next = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 1));
  return { start, end: addDays(toISO(next), -1) };
};

/** `"YYYY-MM-DD"` → `"YYYY-MM"`, the key used by payroll runs and filters. */
export const monthKey = (date: string) => date.slice(0, 7);

/** First calendar day of the month containing `date` (`"2026-10-24"` → `"2026-10-01"`). */
export const startOfMonth = (date: string) => `${monthKey(date)}-01`;

/** Last calendar day of the month containing `date` (`"2026-02-10"` → `"2026-02-28"`). */
export const endOfMonth = (date: string) => monthRange(monthKey(date)).end;

// ── Step 3: "now" in the company timezone ─────────────────────────────────────

/**
 * Current date and minute-of-day in a given IANA timezone.
 *
 * @param tz Timezone from `settings.timezone` (e.g. `"Asia/Karachi"`).
 * @returns `{ date: "YYYY-MM-DD", minutes: 0..1439 }`.
 * @example nowIn("Asia/Karachi") // { date: "2026-10-24", minutes: 585 }
 */
export function nowIn(tz: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return { date: `${g("year")}-${g("month")}-${g("day")}`, minutes: +g("hour") * 60 + +g("minute") };
}

/** Converts `"09:15"` into minutes since midnight (555). */
export const hhmmToMinutes = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};

// ── Step 4: working-day calculation ───────────────────────────────────────────

/**
 * Calendar days in a range that are neither weekend nor public holiday.
 *
 * @param from     Start `YYYY-MM-DD`.
 * @param to       End `YYYY-MM-DD`.
 * @param weekend  Weekend day indexes (0 = Sun … 6 = Sat).
 * @param holidays Public holidays in the range.
 * @returns The working days, ascending.
 */
export function workingDays(from: string, to: string, weekend: number[], holidays: Set<string>) {
  return eachDay(from, to).filter((d) => !weekend.includes(weekday(d)) && !holidays.has(d));
}
