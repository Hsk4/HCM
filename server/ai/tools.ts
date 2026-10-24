/**
 * @fileoverview Role-scoped, read-only tools for the AI assistant.
 *
 * @description
 * This is the security boundary for the assistant. The model can only learn
 * about company data through these tools, and the toolset is built *per user*:
 *
 *  - everyone gets `get_my_leave_balance` (own data only);
 *  - ADMIN and HR additionally get company aggregates and a directory search.
 *
 * There is deliberately no salary tool and no "any employee's data" tool, so an
 * employee asking "what is my colleague's salary?" has no path to an answer —
 * the model can only refuse. Every tool delegates to the same service functions
 * the REST API uses, so permissions are identical on both surfaces.
 *
 * @implementation
 *
 * Step 1: Define the shared date-range input schema (with descriptions the
 *         model reads to choose arguments).
 * Step 2: `deptId` resolves a department *name* (what the model sees) to a UUID.
 * Step 3: Build the base toolset available to every signed-in user.
 * Step 4: For ADMIN/HR, add the aggregate and directory tools.
 * Step 5: Return the registry; `chat/route.ts` passes it to `generateText`
 *         with `stopWhen: stepCountIs(4)`.
 * Step 6: An EMPLOYEE's registry must not contain any aggregate tool.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

// ── Step 1: dependencies and shared schemas ───────────────────────────────────
import { tool, type Tool } from "ai";
import { z } from "zod";
import { SessionUser } from "../auth/session";
import * as analytics from "../services/analytics.service";
import * as leave from "../services/leave.service";
import * as employeeSvc from "../services/employee.service";
import { ilike } from "drizzle-orm";
import { db } from "../db";
import { departments } from "../db/schema";

/** Date window + optional department name, as the model supplies them. */
const range = z.object({
  from: z.iso.date().optional().describe("YYYY-MM-DD, defaults to start of this month"),
  to: z.iso.date().optional().describe("YYYY-MM-DD, defaults to end of this month"),
  department: z.string().optional().describe("Department name"),
});

// ── Step 2: department-name resolution ────────────────────────────────────────

/**
 * Resolves a department name (case-insensitive) to its id.
 *
 * @param name Department name as produced by the model, if any.
 * @returns The department id, or `undefined` when no name was given or it does
 *          not match (an unknown name then simply filters nothing).
 */
async function deptId(name?: string) {
  if (!name) return undefined;
  const [d] = await db.select().from(departments).where(ilike(departments.name, name));
  return d?.id;
}

// ── Steps 3–5: the registry ───────────────────────────────────────────────────

/**
 * Builds the tool registry for one user.
 *
 * @param user The signed-in user; their role decides which tools exist.
 * @returns A map of tool name → AI SDK tool, ready for `generateText({ tools })`.
 */
export function buildTools(user: SessionUser) {
  // Heterogeneous tool set: each entry has its own input/output types, so the
  // registry is widened to AI SDK's base `Tool` shape rather than `any`.
  const tools: Record<string, Tool> = {
    // Step 3: available to every role — own balance only.
    get_my_leave_balance: tool({
      description: "Remaining leave balance for the current user (annual, sick, casual).",
      inputSchema: z.object({ leaveType: z.enum(["annual", "sick", "casual"]).optional() }),
      execute: async ({ leaveType }) => user.employeeId
        ? leave.getBalance(user, user.employeeId, leaveType)
        : { error: "No employee profile for this account" },
    }),
  };

  // Step 4: company-wide tools, ADMIN/HR only.
  if (user.role === "ADMIN" || user.role === "HR") {
    Object.assign(tools, {
      get_headcount: tool({
        description: "Active + probation headcount, optionally for one department.",
        inputSchema: z.object({ department: z.string().optional() }),
        execute: async ({ department }) => analytics.headcount(user, { departmentId: await deptId(department) }),
      }),
      get_attendance_summary: tool({
        description: "Attendance counts and attendance rate for a date range.",
        inputSchema: range,
        execute: async (a) => analytics.attendanceSummary(user, { from: a.from, to: a.to, departmentId: await deptId(a.department) }),
      }),
      get_late_comers: tool({
        description: "Employees with the most late arrivals in a date range.",
        inputSchema: range.extend({ limit: z.number().min(1).max(20).default(5) }),
        execute: async (a) => analytics.lateComers(user, { from: a.from, to: a.to, departmentId: await deptId(a.department), limit: a.limit }),
      }),
      get_leave_summary: tool({
        description: "Approved leave days by type in a date range. Also use for 'who is on leave today'.",
        inputSchema: range.extend({ onlyToday: z.boolean().default(false) }),
        execute: async (a) => a.onlyToday
          ? analytics.onLeaveToday(user)
          : analytics.leaveSummary(user, { from: a.from, to: a.to, departmentId: await deptId(a.department) }),
      }),
      get_payroll_summary: tool({
        description: "Payroll gross/net/average by department for a month (YYYY-MM).",
        inputSchema: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }),
        execute: async ({ month }) => analytics.payrollSummary(user, month),
      }),
      search_employees: tool({
        description: "Find employees by name or code. Returns directory info (no salary).",
        inputSchema: z.object({ q: z.string().min(1) }),
        execute: async ({ q }) => employeeSvc.list(user, { q, page: 1, pageSize: 10 }),
      }),
    });
  }
  return tools;
}
