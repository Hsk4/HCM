import { SessionUser } from "../auth/session";
import { addDays, endOfMonth, nowIn, startOfMonth, weekday } from "../lib/dates";

/**
 * @fileoverview System prompts for the AI assistant: company policy Q&A
 * context, role-scoping rules, and the date table used to resolve relative
 * dates ("next Monday") into concrete calendar days.
 *
 * @description
 * The model may only cite the policy below and only read data through the
 * tools in `server/ai/tools.ts`. Keeping the rules in one module makes the
 * guardrails auditable (see the AI guardrail checklist in the architecture doc).
 */

/** The only company rules the assistant is allowed to quote. */
export const POLICY = `
COMPANY POLICY (the only rules you may cite):
- Office start 09:00, grace 15 min. Late = check-in after 09:15.
- Half day = worked under 5 hours. Weekend is Saturday and Sunday. Public holidays are excluded from working days.
- Absent = no attendance record and no approved leave. missing_checkout = checked in but never checked out.
- One attendance record per employee per day.
- Leave counts working days only. Yearly quotas: annual 14, sick 8, casual 10, unpaid unlimited.
- Overlapping leave or leave beyond the balance is rejected.
- Payroll: gross = 1.5 x basic (HRA 40%, medical 10%). Per day = gross / working days.
  Deductions = absent days + unpaid leave days + 0.5 x half days. Joiners/leavers are prorated.
  Tax is calculated on gross x 12 using slabs: 0-600k: 0; 5% to 1.2M; 30k + 15% to 2.4M; 210k + 25% to 3.6M; 510k + 35% above.
- Only Admin can finalize payroll; finalized payroll is locked.
`;

/**
 * Builds the role-scoped system prompt.
 *
 * @param user  The signed-in user; `role` decides the data scope.
 * @param today Today in the company timezone (`YYYY-MM-DD`).
 * @returns The fully assembled system prompt.
 */
export function systemPrompt(user: SessionUser, today: string) {
  const scope =
    user.role === "ADMIN"
      ? "all company data"
      : user.role === "HR"
        ? "HR-level company data"
        : "ONLY the signed-in employee's own data";
  return `You are the HCM Lite assistant. Signed-in role: ${user.role}. You may use ${scope}.
Today is ${today} (${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][weekday(today)]}).

RULES
1. Answer data questions ONLY from tool results. Never invent numbers. If a tool returns nothing, say so.
2. Answer policy questions ONLY from the policy below. If it is not covered, say "I don't know".
3. Never reveal another employee's salary or personal data. If asked, politely refuse and explain you can only share their own data.
4. If no tool can answer because of the user's role, say you don't have access.
5. Be concise. Reply in the user's language, including Roman Urdu.
${POLICY}`;
}

/**
 * Lists the next 21 days with weekday names so the model resolves relative
 * dates deterministically instead of guessing.
 *
 * @param today Today in the company timezone (`YYYY-MM-DD`).
 * @returns One `"YYYY-MM-DD Ddd"` line per day, newline separated.
 */
export function dateTable(today: string) {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return Array.from({ length: 21 }, (_, i) => {
    const d = addDays(today, i);
    return `${d} ${names[weekday(d)]}`;
  }).join("\n");
}

/**
 * Describes the default reporting window for a "this month" question.
 *
 * @param today Today in the company timezone (`YYYY-MM-DD`).
 * @returns `{ start, end, today, month }` — `start` is the 1st of the month,
 *          `end` the last calendar day (not clamped to `today`).
 */
export function currentMonthWindow(today: string) {
  return {
    start: startOfMonth(today),
    end: endOfMonth(today),
    today,
    month: today.slice(0, 7),
  };
}

/**
 * Convenience wrapper: today's date in the company timezone.
 *
 * @param timezone IANA zone from `settings.timezone`.
 * @returns `YYYY-MM-DD` for that zone.
 */
export function todayIn(timezone: string) {
  return nowIn(timezone).date;
}
