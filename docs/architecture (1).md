# HCM Lite — Architecture (Next.js)

AI-assisted Human Capital Management for Admin, HR and Employees. Built for the Saylani Hackathon.

> **Golden rules**
> 1. The system starts **empty**. No seed data except what first-run setup creates.
> 2. Every permission is checked **on the server**. Hiding a button is not security.
> 3. Business rules live in **services**. Route handlers, dashboards and AI tools all call the same services, so numbers always match.
> 4. The AI **never writes data** and never touches the database directly.

---

## 1. Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15+ (App Router) + TypeScript, Route Handlers as REST API |
| Database | PostgreSQL (Neon free tier) |
| ORM | Drizzle ORM + drizzle-kit |
| Auth | `jose` (JWT in httpOnly cookie) + `bcryptjs` |
| Validation | Zod (API input, CSV rows, AI output) |
| UI | Tailwind + shadcn/ui + Recharts + TanStack Table |
| PDF | `@react-pdf/renderer` |
| CSV | `papaparse` |
| AI | Vercel AI SDK v5 (`ai`) + `@ai-sdk/google` (Gemini Flash, free tier) |
| Tests | Vitest |
| Hosting | Vercel (app) + Neon (DB). Secrets in Vercel env settings |

```bash
bun create next-app hcm-lite --ts --tailwind --app --src-dir
cd hcm-lite
bun add drizzle-orm postgres jose bcryptjs zod papaparse @react-pdf/renderer ai@5 @ai-sdk/google recharts @tanstack/react-table @tanstack/react-query
bun add -d drizzle-kit vitest @types/bcryptjs @types/papaparse tsx
bunx shadcn@latest init
```

> The AI SDK changes between major versions (`inputSchema` vs `parameters`, `stopWhen` vs `maxSteps`, `generateObject`). Pin `ai@5` as above and the snippets here will match.

---

## 2. Environment

`.env.example` (commit this; never commit `.env`):

```bash
DATABASE_URL=postgres://user:pass@host/db?sslmode=require
JWT_SECRET=change-me-to-a-long-random-string-32+chars
AI_API_KEY=your-gemini-key          # server only, never NEXT_PUBLIC_
AI_MODEL=gemini-2.5-flash
# Optional first-run bootstrap (otherwise /setup page is used)
ADMIN_EMAIL=
ADMIN_PASSWORD=
COMPANY_NAME=
```

`src/server/env.ts`:

```ts
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("gemini-2.5-flash"),
  ADMIN_EMAIL: z.string().email().optional().or(z.literal("")),
  ADMIN_PASSWORD: z.string().optional(),
  COMPANY_NAME: z.string().optional(),
});

export const env = schema.parse(process.env);
```

---

## 3. Architecture overview

```
Browser (React, role-based menus, charts, AI panel)
   │  REST JSON + JWT cookie
   ▼
Route Handler  ──►  withAuth(roles)  ──►  Service (rules + scope)  ──►  Drizzle  ──►  Postgres
                                              ▲
AI route  ──►  role-scoped tools  ────────────┘   (same services, same permission checks)
                    │
                    ▼
               LLM API (key on server only)
```

### Folder structure

```
src/
  app/
    (auth)/login/page.tsx
    (auth)/setup/page.tsx                 # first-run
    (auth)/change-password/page.tsx
    (app)/layout.tsx                      # session + shell
    (app)/admin/...                       # dashboard, settings, org, users, payroll, audit
    (app)/hr/...                          # dashboard, employees, attendance, leave, payroll
    (app)/employee/...                    # dashboard, attendance, leave, payslips, profile
    api/
      setup/route.ts
      auth/login|logout|change-password|me/route.ts
      org/{settings,departments,designations,leave-types,holidays}/route.ts
      users/route.ts  users/[id]/route.ts
      employees/route.ts  employees/[id]/route.ts  employees/import/route.ts  employees/export/route.ts
      attendance/check-in|check-out/route.ts  attendance/route.ts  attendance/today/route.ts
      attendance/corrections/route.ts  attendance/corrections/[id]/route.ts
      leave/route.ts  leave/[id]/route.ts  leave/balance/route.ts  leave/preview/route.ts
      payroll/route.ts  payroll/[month]/finalize/route.ts  payslips/[id]/pdf/route.tsx
      salary/[employeeId]/route.ts
      dashboard/{admin,hr,employee}/route.ts
      announcements/route.ts  notifications/route.ts  audit/route.ts
      ai/chat|summary|smart-leave/route.ts
  server/
    env.ts
    errors.ts
    db/{index.ts, schema.ts}
    auth/{session.ts, guard.ts, password.ts}
    lib/{dates.ts, audit.ts, notify.ts}
    services/
      setup.service.ts org.service.ts employee.service.ts attendance.service.ts
      leave.service.ts payroll.service.ts analytics.service.ts comms.service.ts
      daily-status.ts   # shared status resolver (payroll + analytics)
    ai/{provider.ts, tools.ts, prompts.ts, limits.ts, policy.ts}
  components/ ...
drizzle/                                  # generated migrations
tests/
```

### Access matrix (enforced in `withAuth` + services)

| Feature | Admin | HR | Employee |
|---|---|---|---|
| Company settings / departments / leave types / holidays | manage | view | — |
| Create HR login, deactivate/reset any login | manage | — | — |
| Register/edit employee, CSV import/export | view | manage | own phone & address |
| Check in/out | — | — | own |
| Attendance board | all | all | own calendar |
| Corrections | view | approve | request |
| Apply/cancel leave | — | — | own |
| Approve/reject leave | view | approve | — |
| Salary structure | view | manage | — |
| Payroll draft | view | manage | — |
| Finalize payroll | **only Admin** | — | — |
| Payslips | all | all | own |
| Audit log | view | — | — |
| Announcements | post | post | read |
| AI chat scope | all data | HR data | own data |
| AI dashboard summary | yes | yes | — |

---

## 4. Database schema (Drizzle, PostgreSQL)

`src/server/db/index.ts`:

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { env } from "../env";

const globalForDb = globalThis as unknown as { client?: ReturnType<typeof postgres> };
const client = globalForDb.client ?? postgres(env.DATABASE_URL, { max: 5, prepare: false });
if (process.env.NODE_ENV !== "production") globalForDb.client = client;

export const db = drizzle(client, { schema });
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
```

`src/server/db/schema.ts`:

```ts
import {
  pgTable, pgEnum, uuid, text, integer, boolean, timestamp, date,
  numeric, jsonb, doublePrecision, uniqueIndex, index,
} from "drizzle-orm/pg-core";

// ───────── enums ─────────
export const roleEnum = pgEnum("role", ["ADMIN", "HR", "EMPLOYEE"]);
export const empStatusEnum = pgEnum("emp_status", ["probation", "active", "exited"]);
export const attStatusEnum = pgEnum("att_status", ["present", "late", "half_day"]);
export const attSourceEnum = pgEnum("att_source", ["web", "camera", "correction"]);
export const reqStatusEnum = pgEnum("req_status", ["pending", "approved", "rejected", "cancelled"]);
export const payrollStatusEnum = pgEnum("payroll_status", ["draft", "finalized"]);

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// ───────── M1/M2: auth + organization ─────────
export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull(),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
});

/** Singleton row (id = 1). Existence of this row = setup complete. */
export const settings = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  companyName: text("company_name").notNull(),
  officeStart: text("office_start").notNull().default("09:00"),
  graceMinutes: integer("grace_minutes").notNull().default(15),
  halfDayMinutes: integer("half_day_minutes").notNull().default(300), // < 5h
  weekendDays: integer("weekend_days").array().notNull().default([0, 6]), // 0=Sun … 6=Sat
  officeLat: doublePrecision("office_lat"),
  officeLng: doublePrecision("office_lng"),
  officeRadiusM: integer("office_radius_m").notNull().default(150),
  timezone: text("timezone").notNull().default("Asia/Karachi"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const departments = pgTable("departments", {
  id: id(),
  name: text("name").notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
});

export const designations = pgTable("designations", {
  id: id(),
  name: text("name").notNull().unique(),
});

export const leaveTypes = pgTable("leave_types", {
  id: id(),
  code: text("code").notNull().unique(),        // annual | sick | casual | unpaid
  name: text("name").notNull(),
  yearlyQuota: integer("yearly_quota"),         // null = unlimited (unpaid)
  isPaid: boolean("is_paid").notNull().default(true),
});

export const holidays = pgTable("holidays", {
  id: id(),
  date: date("date", { mode: "string" }).notNull().unique(),
  name: text("name").notNull(),
});

// ───────── M3: employees ─────────
export const employees = pgTable("employees", {
  id: id(),
  code: text("code").notNull().unique(),         // EMP-0001
  userId: uuid("user_id").notNull().unique().references(() => users.id),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  gender: text("gender"),
  phone: text("phone"),
  address: text("address"),
  departmentId: uuid("department_id").notNull().references(() => departments.id),
  designationId: uuid("designation_id").references(() => designations.id),
  joinDate: date("join_date", { mode: "string" }).notNull(),
  exitDate: date("exit_date", { mode: "string" }),
  status: empStatusEnum("status").notNull().default("active"),
  createdAt: createdAt(),
}, (t) => [index("emp_dept_idx").on(t.departmentId), index("emp_status_idx").on(t.status)]);

// ───────── M4: attendance ─────────
export const attendance = pgTable("attendance", {
  id: id(),
  employeeId: uuid("employee_id").notNull().references(() => employees.id),
  date: date("date", { mode: "string" }).notNull(),           // office-local date
  checkIn: timestamp("check_in", { withTimezone: true }).notNull(),
  checkOut: timestamp("check_out", { withTimezone: true }),
  status: attStatusEnum("status").notNull().default("present"),
  isLate: boolean("is_late").notNull().default(false),        // kept even if later half_day
  workedMinutes: integer("worked_minutes"),
  source: attSourceEnum("source").notNull().default("web"),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  accuracyM: doublePrecision("accuracy_m"),
}, (t) => [
  uniqueIndex("att_emp_date_uq").on(t.employeeId, t.date),    // second check-in => 409
  index("att_date_idx").on(t.date),
]);

export const attendanceCorrections = pgTable("attendance_corrections", {
  id: id(),
  employeeId: uuid("employee_id").notNull().references(() => employees.id),
  date: date("date", { mode: "string" }).notNull(),
  requestedCheckIn: text("requested_check_in"),               // "HH:mm"
  requestedCheckOut: text("requested_check_out"),
  reason: text("reason").notNull(),
  status: reqStatusEnum("status").notNull().default("pending"),
  decidedBy: uuid("decided_by").references(() => users.id),
  decisionComment: text("decision_comment"),
  createdAt: createdAt(),
});

// ───────── M5: leave ─────────
export const leaveRequests = pgTable("leave_requests", {
  id: id(),
  employeeId: uuid("employee_id").notNull().references(() => employees.id),
  leaveTypeId: uuid("leave_type_id").notNull().references(() => leaveTypes.id),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  days: integer("days").notNull(),                            // working days only
  reason: text("reason"),
  status: reqStatusEnum("status").notNull().default("pending"),
  decidedBy: uuid("decided_by").references(() => users.id),
  decisionComment: text("decision_comment"),
  createdAt: createdAt(),
}, (t) => [index("leave_emp_idx").on(t.employeeId, t.startDate)]);

// ───────── M6: payroll ─────────
export const salaryStructures = pgTable("salary_structures", {
  id: id(),
  employeeId: uuid("employee_id").notNull().references(() => employees.id),
  basic: numeric("basic", { precision: 12, scale: 2, mode: "number" }).notNull(),
  hraPct: integer("hra_pct").notNull().default(40),
  medicalPct: integer("medical_pct").notNull().default(10),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
}, (t) => [index("sal_emp_idx").on(t.employeeId, t.effectiveFrom)]);

export const payrollRuns = pgTable("payroll_runs", {
  id: id(),
  month: text("month").notNull().unique(),                    // "2026-10"
  status: payrollStatusEnum("status").notNull().default("draft"),
  preparedBy: uuid("prepared_by").references(() => users.id),
  finalizedBy: uuid("finalized_by").references(() => users.id),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const payslips = pgTable("payslips", {
  id: id(),
  runId: uuid("run_id").notNull().references(() => payrollRuns.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => employees.id),
  basic: numeric("basic", { precision: 12, scale: 2, mode: "number" }).notNull(),
  gross: numeric("gross", { precision: 12, scale: 2, mode: "number" }).notNull(),
  workingDays: integer("working_days").notNull(),
  absentDays: integer("absent_days").notNull().default(0),
  unpaidDays: integer("unpaid_days").notNull().default(0),
  halfDays: integer("half_days").notNull().default(0),
  ineligibleDays: integer("ineligible_days").notNull().default(0), // before join / after exit
  deduction: numeric("deduction", { precision: 12, scale: 2, mode: "number" }).notNull(),
  tax: numeric("tax", { precision: 12, scale: 2, mode: "number" }).notNull(),
  net: numeric("net", { precision: 12, scale: 2, mode: "number" }).notNull(),
  breakdown: jsonb("breakdown").notNull(),                    // hra, medical, perDay, etc.
}, (t) => [uniqueIndex("slip_run_emp_uq").on(t.runId, t.employeeId)]);

// ───────── M9: comms, audit, AI ─────────
export const announcements = pgTable("announcements", {
  id: id(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  postedBy: uuid("posted_by").notNull().references(() => users.id),
  createdAt: createdAt(),
});

export const notifications = pgTable("notifications", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  body: text("body"),
  link: text("link"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("notif_user_idx").on(t.userId, t.createdAt)]);

export const auditLogs = pgTable("audit_logs", {
  id: id(),
  actorId: uuid("actor_id").references(() => users.id),
  actorRole: text("actor_role"),
  action: text("action").notNull(),                           // e.g. "leave.approve"
  entity: text("entity").notNull(),                           // e.g. "leave_request"
  entityId: text("entity_id"),
  before: jsonb("before"),
  after: jsonb("after"),
  createdAt: createdAt(),
}, (t) => [index("audit_created_idx").on(t.createdAt)]);

export const aiLogs = pgTable("ai_logs", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  kind: text("kind").notNull(),                               // chat | summary | smart_leave
  prompt: text("prompt").notNull(),
  response: text("response"),
  toolsUsed: text("tools_used").array(),
  latencyMs: integer("latency_ms"),
  error: text("error"),
  createdAt: createdAt(),
}, (t) => [index("ailog_user_idx").on(t.userId, t.createdAt)]);
```

`drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

```bash
bunx drizzle-kit generate && bunx drizzle-kit migrate
```

### Audit log immutability (custom migration)

Create an empty migration with `bunx drizzle-kit generate --custom --name=audit_immutable` and paste:

```sql
CREATE OR REPLACE FUNCTION audit_block_changes() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER audit_no_update_delete
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION audit_block_changes();
```

### Finalized payroll lock (defense in depth)

```sql
CREATE OR REPLACE FUNCTION payslip_lock() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM payroll_runs r WHERE r.id = COALESCE(NEW.run_id, OLD.run_id) AND r.status = 'finalized') THEN
    RAISE EXCEPTION 'payroll run is finalized';
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER payslip_lock_trg
BEFORE INSERT OR UPDATE OR DELETE ON payslips
FOR EACH ROW EXECUTE FUNCTION payslip_lock();
```

---

## 5. Core utilities

### Errors — `src/server/errors.ts`

```ts
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}
export const badRequest = (m: string, d?: unknown) => new AppError(400, "BAD_REQUEST", m, d);
export const forbidden = (m = "You are not allowed to do this") => new AppError(403, "FORBIDDEN", m);
export const notFound = (m = "Not found") => new AppError(404, "NOT_FOUND", m);
export const conflict = (m: string) => new AppError(409, "CONFLICT", m);
export const unprocessable = (m: string, d?: unknown) => new AppError(422, "UNPROCESSABLE", m, d);

export function errorResponse(e: unknown) {
  if (e instanceof AppError)
    return Response.json({ error: { code: e.code, message: e.message, details: e.details } }, { status: e.status });
  if (e instanceof ZodError)
    return Response.json({ error: { code: "VALIDATION", message: "Invalid input", details: e.flatten() } }, { status: 400 });
  console.error(e);
  return Response.json({ error: { code: "INTERNAL", message: "Something went wrong" } }, { status: 500 });
}
```

### Dates — `src/server/lib/dates.ts`

All dates are `YYYY-MM-DD` strings in the **office timezone**. Doing arithmetic in UTC on those strings avoids timezone bugs.

```ts
export const toISO = (d: Date) => d.toISOString().slice(0, 10);
export const parseISO = (s: string) => new Date(`${s}T00:00:00Z`);
export const weekday = (s: string) => parseISO(s).getUTCDay(); // 0=Sun … 6=Sat

export function addDays(s: string, n: number) {
  const d = parseISO(s);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export const monthRange = (month: string) => {
  const start = `${month}-01`;
  const next = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 1));
  return { start, end: addDays(toISO(next), -1) };
};

/** Current office-local date and minutes-since-midnight. The SERVER is the clock. */
export function nowIn(tz: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return { date: `${g("year")}-${g("month")}-${g("day")}`, minutes: +g("hour") * 60 + +g("minute") };
}

export const hhmmToMinutes = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};

export function workingDays(from: string, to: string, weekend: number[], holidays: Set<string>) {
  return eachDay(from, to).filter((d) => !weekend.includes(weekday(d)) && !holidays.has(d));
}
```

### Passwords — `src/server/auth/password.ts`

```ts
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

export const hashPassword = (p: string) => bcrypt.hash(p, 10);
export const verifyPassword = (p: string, hash: string) => bcrypt.compare(p, hash);

export function tempPassword() {
  // 12 chars, URL-safe. Shown to HR exactly once.
  return randomBytes(9).toString("base64url");
}
```

### Session — `src/server/auth/session.ts`

```ts
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users, employees } from "../db/schema";
import { env } from "../env";

export type Role = "ADMIN" | "HR" | "EMPLOYEE";
export type SessionUser = {
  id: string; email: string; role: Role;
  employeeId: string | null; mustChangePassword: boolean;
};

const COOKIE = "hcm_session";
const key = new TextEncoder().encode(env.JWT_SECRET);

export async function createSession(userId: string) {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt().setExpirationTime("8h").sign(key);
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    path: "/", maxAge: 60 * 60 * 8,
  });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

/** Role/active flag are re-read from the DB on every request, never trusted from the token. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key);
    const [row] = await db
      .select({
        id: users.id, email: users.email, role: users.role, isActive: users.isActive,
        mustChangePassword: users.mustChangePassword, employeeId: employees.id,
      })
      .from(users).leftJoin(employees, eq(employees.userId, users.id))
      .where(eq(users.id, payload.sub as string));
    if (!row || !row.isActive) return null;
    return { id: row.id, email: row.email, role: row.role, employeeId: row.employeeId, mustChangePassword: row.mustChangePassword };
  } catch {
    return null;
  }
}
```

### Guard — `src/server/auth/guard.ts`

```ts
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { AppError, errorResponse } from "../errors";
import { getSessionUser, Role, SessionUser } from "./session";

type Ctx = { params: Promise<Record<string, string>> };
type Handler = (req: NextRequest, ctx: Ctx, user: SessionUser) => Promise<Response>;

export function withAuth(roles: Role[], handler: Handler, opts: { allowMustChange?: boolean } = {}) {
  return async (req: NextRequest, ctx: Ctx) => {
    try {
      const user = await getSessionUser();
      if (!user) throw new AppError(401, "UNAUTHENTICATED", "Please sign in");
      if (!roles.includes(user.role)) throw new AppError(403, "FORBIDDEN", "Not allowed");
      if (user.mustChangePassword && !opts.allowMustChange)
        throw new AppError(403, "PASSWORD_CHANGE_REQUIRED", "Change your temporary password first");
      return await handler(req, ctx, user);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/** For server components / layouts. */
export async function requireRole(roles: Role[]) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/change-password");
  if (!roles.includes(user.role)) redirect(`/${user.role.toLowerCase()}`);
  return user;
}
```

Usage:

```ts
// app/api/attendance/check-in/route.ts
export const POST = withAuth(["EMPLOYEE"], async (req, _ctx, user) => {
  const body = checkInSchema.parse(await req.json().catch(() => ({})));
  return Response.json(await attendanceService.checkIn(user, body), { status: 201 });
});
```

### Audit + notifications — `src/server/lib/audit.ts`

Call this from **every** mutating service, inside the same transaction.

```ts
import { db, Tx } from "../db";
import { auditLogs, notifications } from "../db/schema";
import { SessionUser } from "../auth/session";

type Runner = Tx | typeof db;

export async function audit(
  r: Runner, actor: SessionUser | null,
  action: string, entity: string, entityId: string | null,
  before: unknown = null, after: unknown = null,
) {
  await r.insert(auditLogs).values({
    actorId: actor?.id ?? null, actorRole: actor?.role ?? null,
    action, entity, entityId, before: before as any, after: after as any,
  });
}

export async function notify(r: Runner, userId: string, title: string, body?: string, link?: string) {
  await r.insert(notifications).values({ userId, title, body, link });
}
```

### Settings helpers — `src/server/services/org.service.ts` (excerpt)

```ts
import { and, between, eq } from "drizzle-orm";
import { db } from "../db";
import { settings, holidays } from "../db/schema";
import { AppError } from "../errors";

export async function getSettings() {
  const [s] = await db.select().from(settings).where(eq(settings.id, 1));
  if (!s) throw new AppError(409, "SETUP_REQUIRED", "Run first-time setup");
  return s;
}

export async function holidaySet(from: string, to: string) {
  const rows = await db.select({ date: holidays.date }).from(holidays).where(between(holidays.date, from, to));
  return new Set(rows.map((r) => r.date));
}
```

---

## 6. First-run setup and auth (M1, M2)

`src/server/services/setup.service.ts`:

```ts
import { db } from "../db";
import { users, settings, leaveTypes } from "../db/schema";
import { hashPassword } from "../auth/password";
import { conflict } from "../errors";
import { audit } from "../lib/audit";
import { env } from "../env";

export async function needsSetup() {
  const rows = await db.select({ id: settings.id }).from(settings).limit(1);
  return rows.length === 0;
}

export async function runSetup(input: { companyName: string; adminEmail: string; adminPassword: string }) {
  return db.transaction(async (tx) => {
    const existing = await tx.select({ id: settings.id }).from(settings).limit(1);
    if (existing.length) throw conflict("Setup already completed");

    await tx.insert(settings).values({ id: 1, companyName: input.companyName });
    const [admin] = await tx.insert(users).values({
      email: input.adminEmail.toLowerCase(),
      passwordHash: await hashPassword(input.adminPassword),
      role: "ADMIN",
    }).returning();

    // Default leave types are RULES, not dummy data (brief section 3).
    await tx.insert(leaveTypes).values([
      { code: "annual", name: "Annual", yearlyQuota: 14, isPaid: true },
      { code: "sick", name: "Sick", yearlyQuota: 8, isPaid: true },
      { code: "casual", name: "Casual", yearlyQuota: 10, isPaid: true },
      { code: "unpaid", name: "Unpaid", yearlyQuota: null, isPaid: false },
    ]);
    await audit(tx, null, "setup.complete", "company", "1", null, { companyName: input.companyName });
    return { adminId: admin.id };
  });
}

/** Optional: call from GET /api/setup/status so ADMIN_EMAIL/ADMIN_PASSWORD env works. */
export async function bootstrapFromEnv() {
  if (!(await needsSetup())) return;
  if (env.ADMIN_EMAIL && env.ADMIN_PASSWORD)
    await runSetup({ companyName: env.COMPANY_NAME || "My Company", adminEmail: env.ADMIN_EMAIL, adminPassword: env.ADMIN_PASSWORD });
}
```

`app/api/setup/route.ts`:

```ts
import { z } from "zod";
import { bootstrapFromEnv, needsSetup, runSetup } from "@/server/services/setup.service";
import { errorResponse } from "@/server/errors";

const schema = z.object({
  companyName: z.string().min(2),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(8),
});

export async function GET() {
  await bootstrapFromEnv();
  return Response.json({ needsSetup: await needsSetup() });
}

export async function POST(req: Request) {
  try {
    const out = await runSetup(schema.parse(await req.json()));
    return Response.json(out, { status: 201 });
  } catch (e) { return errorResponse(e); }
}
```

The login page calls `GET /api/setup/status` and redirects to `/setup` when `needsSetup` is true. This is also what makes the hosted link "start from first-run setup".

`app/api/auth/login/route.ts`:

```ts
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { verifyPassword } from "@/server/auth/password";
import { createSession } from "@/server/auth/session";
import { AppError, errorResponse } from "@/server/errors";
import { audit } from "@/server/lib/audit";

const schema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(req: Request) {
  try {
    const { email, password } = schema.parse(await req.json());
    const [u] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
    // Same message for unknown user / wrong password / inactive
    if (!u || !u.isActive || !(await verifyPassword(password, u.passwordHash)))
      throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
    await createSession(u.id);
    await audit(db, { id: u.id, role: u.role } as any, "auth.login", "user", u.id);
    return Response.json({ role: u.role, mustChangePassword: u.mustChangePassword });
  } catch (e) { return errorResponse(e); }
}
```

`app/api/auth/change-password/route.ts` (note `allowMustChange`):

```ts
export const POST = withAuth(["ADMIN", "HR", "EMPLOYEE"], async (req, _c, user) => {
  const { current, next } = z.object({ current: z.string(), next: z.string().min(8) }).parse(await req.json());
  const [u] = await db.select().from(users).where(eq(users.id, user.id));
  if (!(await verifyPassword(current, u.passwordHash))) throw new AppError(400, "WRONG_PASSWORD", "Current password is wrong");
  await db.update(users).set({ passwordHash: await hashPassword(next), mustChangePassword: false }).where(eq(users.id, user.id));
  await audit(db, user, "auth.change_password", "user", user.id);
  return Response.json({ ok: true });
}, { allowMustChange: true });
```

### Role layouts and menus

`app/(app)/admin/layout.tsx`:

```tsx
import { requireRole } from "@/server/auth/guard";
import { Shell } from "@/components/shell";
import { ADMIN_MENU } from "@/components/menus";

export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await requireRole(["ADMIN"]);
  return <Shell user={user} menu={ADMIN_MENU}>{children}</Shell>;
}
```

`components/menus.ts`:

```ts
export const ADMIN_MENU = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/settings", label: "Company settings" },
  { href: "/admin/org", label: "Departments & leave types" },
  { href: "/admin/users", label: "Logins" },
  { href: "/admin/employees", label: "Employees" },
  { href: "/admin/payroll", label: "Payroll" },
  { href: "/admin/announcements", label: "Announcements" },
  { href: "/admin/audit", label: "Audit log" },
];
export const HR_MENU = [
  { href: "/hr", label: "Dashboard" },
  { href: "/hr/employees", label: "Employees" },
  { href: "/hr/attendance", label: "Attendance board" },
  { href: "/hr/leave", label: "Leave approvals" },
  { href: "/hr/payroll", label: "Payroll" },
  { href: "/hr/announcements", label: "Announcements" },
];
export const EMPLOYEE_MENU = [
  { href: "/employee", label: "Dashboard" },
  { href: "/employee/attendance", label: "Attendance" },
  { href: "/employee/leave", label: "Leave" },
  { href: "/employee/payslips", label: "Payslips" },
  { href: "/employee/profile", label: "Profile" },
];
```

---

## 7. Employees (M3)

`src/server/services/employee.service.ts`:

```ts
import { and, eq, ilike, or, sql, count } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { users, employees, salaryStructures, departments } from "../db/schema";
import { hashPassword, tempPassword } from "../auth/password";
import { SessionUser } from "../auth/session";
import { conflict, forbidden, notFound } from "../errors";
import { audit, notify } from "../lib/audit";

export const registerSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1), lastName: z.string().min(1),
  departmentId: z.string().uuid(),
  designationId: z.string().uuid().optional(),
  joinDate: z.string().date(),
  basicSalary: z.number().positive(),
  phone: z.string().optional(), address: z.string().optional(), gender: z.string().optional(),
  status: z.enum(["probation", "active"]).default("active"),
});
export type RegisterInput = z.infer<typeof registerSchema>;

async function nextCode(tx: any) {
  const [{ n }] = await tx.select({ n: count() }).from(employees);
  return `EMP-${String(n + 1).padStart(4, "0")}`;
}

/** HR only. Creates login + employee + salary structure atomically. */
export async function register(user: SessionUser, input: RegisterInput) {
  if (user.role !== "HR") throw forbidden("Only HR registers employees");
  return db.transaction(async (tx) => {
    const email = input.email.toLowerCase();
    const dup = await tx.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (dup.length) throw conflict("Email already registered");

    const temp = tempPassword();
    const [u] = await tx.insert(users).values({
      email, passwordHash: await hashPassword(temp), role: "EMPLOYEE", mustChangePassword: true,
    }).returning();
    const [e] = await tx.insert(employees).values({
      code: await nextCode(tx), userId: u.id,
      firstName: input.firstName, lastName: input.lastName, gender: input.gender,
      phone: input.phone, address: input.address,
      departmentId: input.departmentId, designationId: input.designationId,
      joinDate: input.joinDate, status: input.status,
    }).returning();
    await tx.insert(salaryStructures).values({
      employeeId: e.id, basic: input.basicSalary, effectiveFrom: input.joinDate, createdBy: user.id,
    });
    await audit(tx, user, "employee.register", "employee", e.id, null, { ...e, basicSalary: input.basicSalary });
    await notify(tx, u.id, "Welcome", "Your account is ready. Change your temporary password on first sign-in.");
    return { employee: e, login: { email, temporaryPassword: temp } }; // shown once
  });
}

export const listSchema = z.object({
  q: z.string().optional(), departmentId: z.string().uuid().optional(),
  status: z.enum(["probation", "active", "exited"]).optional(),
  page: z.coerce.number().min(1).default(1), pageSize: z.coerce.number().min(1).max(100).default(20),
});

/** Server-side search, filters, paging. Employee role can only ever see their own row. */
export async function list(user: SessionUser, f: z.infer<typeof listSchema>) {
  const where = and(
    user.role === "EMPLOYEE" ? eq(employees.id, user.employeeId ?? "00000000-0000-0000-0000-000000000000") : undefined,
    f.departmentId ? eq(employees.departmentId, f.departmentId) : undefined,
    f.status ? eq(employees.status, f.status) : undefined,
    f.q ? or(ilike(employees.firstName, `%${f.q}%`), ilike(employees.lastName, `%${f.q}%`), ilike(employees.code, `%${f.q}%`)) : undefined,
  );
  const rows = await db.select({
      id: employees.id, code: employees.code, firstName: employees.firstName, lastName: employees.lastName,
      department: departments.name, status: employees.status, joinDate: employees.joinDate,
    })
    .from(employees).innerJoin(departments, eq(departments.id, employees.departmentId))
    .where(where).limit(f.pageSize).offset((f.page - 1) * f.pageSize).orderBy(employees.code);
  const [{ total }] = await db.select({ total: count() }).from(employees).where(where);
  return { rows, total, page: f.page, pageSize: f.pageSize };
}

/** Employee 360. Salary is only returned to Admin/HR. */
export async function get360(user: SessionUser, id: string) {
  if (user.role === "EMPLOYEE" && user.employeeId !== id) throw forbidden();
  const [e] = await db.select().from(employees).where(eq(employees.id, id));
  if (!e) throw notFound("Employee not found");
  const base = { ...e };
  if (user.role === "EMPLOYEE") return base;
  const [sal] = await db.select().from(salaryStructures).where(eq(salaryStructures.employeeId, id))
    .orderBy(sql`${salaryStructures.effectiveFrom} desc`).limit(1);
  return { ...base, salary: sal ?? null };
}

/** Employee may only change phone and address. */
export async function updateOwnContact(user: SessionUser, input: { phone?: string; address?: string }) {
  if (!user.employeeId) throw forbidden();
  const [before] = await db.select().from(employees).where(eq(employees.id, user.employeeId));
  const [after] = await db.update(employees).set({ phone: input.phone, address: input.address })
    .where(eq(employees.id, user.employeeId)).returning();
  await audit(db, user, "employee.update_contact", "employee", user.employeeId, before, after);
  return after;
}
```

### CSV import with dry-run (`POST /api/employees/import?dryRun=true`)

Brief checks: required fields, unique code/email, valid email, known dept, ISO date, salary > 0. Errors return `{row, field, reason}`.

```ts
import Papa from "papaparse";
import { z } from "zod";

const rowSchema = z.object({
  code: z.string().min(1, "required"),
  email: z.string().email("invalid email"),
  firstName: z.string().min(1, "required"),
  lastName: z.string().min(1, "required"),
  department: z.string().min(1, "required"),
  joinDate: z.string().date("must be ISO date YYYY-MM-DD"),
  salary: z.coerce.number().positive("must be > 0"),
});

export async function importCsv(user: SessionUser, csv: string, dryRun: boolean) {
  if (user.role !== "HR") throw forbidden();
  const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
  const depts = new Map((await db.select().from(departments)).map((d) => [d.name.toLowerCase(), d.id]));
  const existing = await db.select({ email: users.email }).from(users);
  const existingCodes = await db.select({ code: employees.code }).from(employees);
  const emails = new Set(existing.map((u) => u.email));
  const codes = new Set(existingCodes.map((c) => c.code));

  const errors: { row: number; field: string; reason: string }[] = [];
  const valid: (z.infer<typeof rowSchema> & { departmentId: string })[] = [];

  parsed.data.forEach((raw, i) => {
    const row = i + 2; // header is row 1
    const r = rowSchema.safeParse(raw);
    if (!r.success) {
      r.error.issues.forEach((is) => errors.push({ row, field: String(is.path[0]), reason: is.message }));
      return;
    }
    const d = r.data;
    const email = d.email.toLowerCase();
    let ok = true;
    if (!depts.has(d.department.toLowerCase())) { errors.push({ row, field: "department", reason: "unknown department" }); ok = false; }
    if (emails.has(email)) { errors.push({ row, field: "email", reason: "duplicate email" }); ok = false; }
    if (codes.has(d.code)) { errors.push({ row, field: "code", reason: "duplicate code" }); ok = false; }
    if (ok) { emails.add(email); codes.add(d.code); valid.push({ ...d, departmentId: depts.get(d.department.toLowerCase())! }); }
  });

  if (dryRun || errors.length) return { dryRun, imported: 0, valid: valid.length, errors };
  // Real import: call register() per valid row inside one transaction (pass tx through) and return temp passwords.
  return { dryRun: false, imported: valid.length, valid: valid.length, errors };
}
```

CSV export: `GET /api/employees/export` builds rows from `list()` with `Papa.unparse(rows)` and returns `text/csv` with `Content-Disposition: attachment`.

---

## 8. Attendance (M4)

### Shared daily-status resolver — `services/daily-status.ts`

One function decides what each employee-day is. Payroll, dashboards and AI all use it, so numbers can never disagree.

```ts
import { and, between, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "../db";
import { attendance, leaveRequests, leaveTypes } from "../db/schema";
import { getSettings, holidaySet } from "./org.service";
import { workingDays, nowIn } from "../lib/dates";

export type DayStatus =
  | "present" | "late" | "half_day" | "missing_checkout"
  | "absent" | "on_leave" | "unpaid_leave";

/**
 * Returns, per employee, a map of working-day -> status for days up to (not including) today,
 * plus today's status ONLY if a record exists. Weekends/holidays are never in the map.
 */
export async function resolveDailyStatuses(empIds: string[], from: string, to: string) {
  const s = await getSettings();
  const { date: today } = nowIn(s.timezone);
  const days = workingDays(from, to, s.weekendDays, await holidaySet(from, to));
  const result = new Map<string, Map<string, DayStatus>>();
  empIds.forEach((id) => result.set(id, new Map()));
  if (!empIds.length) return { days, today, byEmployee: result };

  const [att, leaves] = await Promise.all([
    db.select().from(attendance).where(and(inArray(attendance.employeeId, empIds), between(attendance.date, from, to))),
    db.select({
        employeeId: leaveRequests.employeeId, start: leaveRequests.startDate,
        end: leaveRequests.endDate, isPaid: leaveTypes.isPaid,
      }).from(leaveRequests).innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(and(inArray(leaveRequests.employeeId, empIds), eq(leaveRequests.status, "approved"),
        lte(leaveRequests.startDate, to), gte(leaveRequests.endDate, from))),
  ]);

  const attKey = new Map(att.map((a) => [`${a.employeeId}|${a.date}`, a]));

  for (const id of empIds) {
    const m = result.get(id)!;
    for (const d of days) {
      if (d > today) continue;
      const a = attKey.get(`${id}|${d}`);
      if (a) {
        m.set(d, !a.checkOut && d < today ? "missing_checkout" : a.status);
        continue;
      }
      const lv = leaves.find((l) => l.employeeId === id && l.start <= d && d <= l.end);
      if (lv) { m.set(d, lv.isPaid ? "on_leave" : "unpaid_leave"); continue; }
      if (d < today) m.set(d, "absent");   // today without a record is "not yet", not absent
    }
  }
  return { days, today, byEmployee: result };
}
```

### Service — `services/attendance.service.ts`

```ts
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { attendance } from "../db/schema";
import { SessionUser } from "../auth/session";
import { conflict, forbidden, unprocessable } from "../errors";
import { getSettings } from "./org.service";
import { hhmmToMinutes, nowIn } from "../lib/dates";
import { audit } from "../lib/audit";

type Geo = { lat?: number; lng?: number; accuracy?: number };

export async function checkIn(user: SessionUser, geo: Geo & { source?: "web" | "camera" } = {}) {
  if (user.role !== "EMPLOYEE" || !user.employeeId) throw forbidden();
  const s = await getSettings();
  const { date, minutes } = nowIn(s.timezone);

  // Optional geofence for camera source (see section 14)
  if (geo.source === "camera") await assertInsideOffice(s, geo);

  // NOTE: do NOT reject weekends/holidays. Someone may work on a Saturday.
  const isLate = minutes > hhmmToMinutes(s.officeStart) + s.graceMinutes;
  const [row] = await db.insert(attendance).values({
    employeeId: user.employeeId, date, checkIn: new Date(),
    status: isLate ? "late" : "present", isLate, source: geo.source ?? "web",
    lat: geo.lat, lng: geo.lng, accuracyM: geo.accuracy,
  }).onConflictDoNothing({ target: [attendance.employeeId, attendance.date] }).returning();

  if (!row) throw conflict("Already checked in today"); // 409 from unique index
  return row;
}

export async function checkOut(user: SessionUser) {
  if (user.role !== "EMPLOYEE" || !user.employeeId) throw forbidden();
  const s = await getSettings();
  const { date } = nowIn(s.timezone);
  const [rec] = await db.select().from(attendance)
    .where(and(eq(attendance.employeeId, user.employeeId), eq(attendance.date, date)));
  if (!rec) throw unprocessable("You have not checked in today");
  if (rec.checkOut) throw conflict("Already checked out");

  const now = new Date();
  const worked = Math.floor((now.getTime() - rec.checkIn.getTime()) / 60000);
  const status = worked < s.halfDayMinutes ? "half_day" : rec.status;
  const [after] = await db.update(attendance)
    .set({ checkOut: now, workedMinutes: worked, status })
    .where(eq(attendance.id, rec.id)).returning();
  return after;
}
```

### Corrections

```ts
// Employee requests; HR approves. Approval rewrites the attendance row (source = "correction").
export async function decideCorrection(user: SessionUser, id: string, approve: boolean, comment?: string) {
  if (user.role !== "HR") throw forbidden("Only HR approves corrections");
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(attendanceCorrections).where(eq(attendanceCorrections.id, id));
    if (!c || c.status !== "pending") throw unprocessable("Request is not pending");
    await tx.update(attendanceCorrections)
      .set({ status: approve ? "approved" : "rejected", decidedBy: user.id, decisionComment: comment })
      .where(eq(attendanceCorrections.id, id));
    if (approve) {
      // upsert attendance row for c.date using requestedCheckIn/Out, recompute isLate/status/workedMinutes
      // with the SAME rule functions used in checkIn/checkOut (extract them into pure helpers).
    }
    await audit(tx, user, `correction.${approve ? "approve" : "reject"}`, "attendance_correction", id, c, { comment });
    // notify employee here
  });
}
```

> Tip: extract `computeStatus(checkInMinutes, workedMinutes, settings)` as a pure function so check-in, check-out and corrections share it and it can be unit-tested.

---

## 9. Leave (M5)

`services/leave.service.ts`:

```ts
import { and, eq, inArray, lte, gte, sql } from "drizzle-orm";
import { db } from "../db";
import { leaveRequests, leaveTypes } from "../db/schema";
import { SessionUser } from "../auth/session";
import { forbidden, notFound, unprocessable } from "../errors";
import { getSettings, holidaySet } from "./org.service";
import { workingDays } from "../lib/dates";
import { audit, notify } from "../lib/audit";

export async function countWorkingDays(start: string, end: string) {
  if (end < start) throw unprocessable("End date is before start date");
  const s = await getSettings();
  return workingDays(start, end, s.weekendDays, await holidaySet(start, end)).length;
}

export async function getBalance(user: SessionUser, employeeId: string, code?: string, year = new Date().getFullYear()) {
  if (user.role === "EMPLOYEE" && user.employeeId !== employeeId) throw forbidden();
  const types = await db.select().from(leaveTypes);
  const used = await db.select({
      typeId: leaveRequests.leaveTypeId,
      days: sql<number>`coalesce(sum(${leaveRequests.days}), 0)::int`,
    }).from(leaveRequests)
    .where(and(eq(leaveRequests.employeeId, employeeId),
      inArray(leaveRequests.status, ["approved", "pending"]),   // pending reserves balance
      gte(leaveRequests.startDate, `${year}-01-01`), lte(leaveRequests.startDate, `${year}-12-31`)))
    .groupBy(leaveRequests.leaveTypeId);
  const usedMap = new Map(used.map((u) => [u.typeId, u.days]));
  return types
    .filter((t) => !code || t.code === code)
    .map((t) => ({
      type: t.code, quota: t.yearlyQuota, used: usedMap.get(t.id) ?? 0,
      remaining: t.yearlyQuota == null ? null : t.yearlyQuota - (usedMap.get(t.id) ?? 0),
    }));
}

/** Pure validation shared by apply() and the smart-leave preview. Throws 422 on any rule break. */
export async function validate(employeeId: string, code: string, start: string, end: string) {
  const [type] = await db.select().from(leaveTypes).where(eq(leaveTypes.code, code));
  if (!type) throw unprocessable("Unknown leave type");
  const days = await countWorkingDays(start, end);
  if (days === 0) throw unprocessable("Selected dates contain no working days");

  const overlap = await db.select({ id: leaveRequests.id }).from(leaveRequests).where(and(
    eq(leaveRequests.employeeId, employeeId),
    inArray(leaveRequests.status, ["pending", "approved"]),
    lte(leaveRequests.startDate, end), gte(leaveRequests.endDate, start)));
  if (overlap.length) throw unprocessable("You already have leave in this period");

  if (type.yearlyQuota != null) {
    const [bal] = await getBalance({ role: "ADMIN" } as any, employeeId, code, +start.slice(0, 4));
    if (days > (bal.remaining ?? 0)) throw unprocessable(`Only ${bal.remaining} ${code} day(s) left`);
  }
  return { type, days };
}

export async function apply(user: SessionUser, input: { type: string; start: string; end: string; reason?: string }) {
  if (user.role !== "EMPLOYEE" || !user.employeeId) throw forbidden();
  const { type, days } = await validate(user.employeeId, input.type, input.start, input.end);
  return db.transaction(async (tx) => {
    const [r] = await tx.insert(leaveRequests).values({
      employeeId: user.employeeId!, leaveTypeId: type.id,
      startDate: input.start, endDate: input.end, days, reason: input.reason,
    }).returning();
    await audit(tx, user, "leave.apply", "leave_request", r.id, null, r);
    return r;
  });
}

export async function cancel(user: SessionUser, id: string) {
  const [r] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, id));
  if (!r) throw notFound();
  if (r.employeeId !== user.employeeId) throw forbidden();
  if (!["pending", "approved"].includes(r.status)) throw unprocessable("Cannot cancel this request");
  const [after] = await db.update(leaveRequests).set({ status: "cancelled" }).where(eq(leaveRequests.id, id)).returning();
  await audit(db, user, "leave.cancel", "leave_request", id, r, after);
  return after;
}

/** HR decides. Admin only views. */
export async function decide(user: SessionUser, id: string, approve: boolean, comment: string) {
  if (user.role !== "HR") throw forbidden("Only HR approves leave");
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(leaveRequests).where(eq(leaveRequests.id, id));
    if (!r || r.status !== "pending") throw unprocessable("Request is not pending");
    const [after] = await tx.update(leaveRequests)
      .set({ status: approve ? "approved" : "rejected", decidedBy: user.id, decisionComment: comment })
      .where(eq(leaveRequests.id, id)).returning();
    await audit(tx, user, `leave.${approve ? "approve" : "reject"}`, "leave_request", id, r, after);
    // notify the employee's user (look up users.id via employees.userId)
    return after;
  });
}
```

> **422** is thrown by `unprocessable` for overlap and over-balance, as the brief requires. Quota is computed from requests, so no separate balance table is needed.

---

## 10. Payroll (M6)

`services/payroll.service.ts`:

```ts
import { and, eq, lte, desc, inArray } from "drizzle-orm";
import { db } from "../db";
import { employees, salaryStructures, payrollRuns, payslips } from "../db/schema";
import { SessionUser } from "../auth/session";
import { forbidden, conflict, notFound } from "../errors";
import { getSettings, holidaySet } from "./org.service";
import { resolveDailyStatuses } from "./daily-status";
import { monthRange, workingDays } from "../lib/dates";
import { audit, notify } from "../lib/audit";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Annual tax slab from the brief (illustrative). Applied to gross × 12. */
export function annualTax(annual: number) {
  const slabs = [
    { from: 0,         upTo: 600_000,  base: 0,       rate: 0 },
    { from: 600_000,   upTo: 1_200_000, base: 0,      rate: 0.05 },
    { from: 1_200_000, upTo: 2_400_000, base: 30_000, rate: 0.15 },
    { from: 2_400_000, upTo: 3_600_000, base: 210_000, rate: 0.25 },
    { from: 3_600_000, upTo: Infinity, base: 510_000, rate: 0.35 },
  ];
  const s = slabs.find((x) => annual <= x.upTo)!;
  return s.base + (annual - s.from) * s.rate;
}

export function grossFromBasic(basic: number, hraPct = 40, medicalPct = 10) {
  return basic * (1 + hraPct / 100 + medicalPct / 100); // = 1.5 × basic by default
}

export type PayslipInput = {
  basic: number; hraPct: number; medicalPct: number;
  monthWorkingDays: string[];          // all working days in the month
  statuses: Map<string, string>;       // from resolveDailyStatuses
  joinDate: string; exitDate: string | null;
};

/** Pure function: easy to unit test. */
export function computePayslip(i: PayslipInput) {
  const gross = grossFromBasic(i.basic, i.hraPct, i.medicalPct);
  const total = i.monthWorkingDays.length || 1;
  const perDay = gross / total;

  let absent = 0, unpaid = 0, half = 0, ineligible = 0;
  for (const d of i.monthWorkingDays) {
    if (d < i.joinDate || (i.exitDate && d > i.exitDate)) { ineligible++; continue; } // proration
    const st = i.statuses.get(d);
    if (st === "absent") absent++;
    else if (st === "unpaid_leave") unpaid++;
    else if (st === "half_day") half++;
  }
  const deductDays = ineligible + absent + unpaid + 0.5 * half;
  const deduction = Math.min(gross, perDay * deductDays);
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

/** HR creates or regenerates the draft. Finalized months are locked. */
export async function createDraft(user: SessionUser, month: string) {
  if (user.role !== "HR") throw forbidden("Only HR prepares payroll");
  const { start, end } = monthRange(month);
  const s = await getSettings();
  const mDays = workingDays(start, end, s.weekendDays, await holidaySet(start, end));

  return db.transaction(async (tx) => {
    let [run] = await tx.select().from(payrollRuns).where(eq(payrollRuns.month, month));
    if (run?.status === "finalized") throw conflict("This month is finalized and locked");
    if (!run) [run] = await tx.insert(payrollRuns).values({ month, preparedBy: user.id }).returning();
    else await tx.delete(payslips).where(eq(payslips.runId, run.id));

    const emps = await tx.select().from(employees).where(
      // joined on/before month end, and not exited before month start
      and(lte(employees.joinDate, end)));
    const active = emps.filter((e) => !e.exitDate || e.exitDate >= start);
    const ids = active.map((e) => e.id);
    const { byEmployee } = await resolveDailyStatuses(ids, start, end);

    for (const e of active) {
      const [sal] = await tx.select().from(salaryStructures)
        .where(and(eq(salaryStructures.employeeId, e.id), lte(salaryStructures.effectiveFrom, end)))
        .orderBy(desc(salaryStructures.effectiveFrom)).limit(1);
      if (!sal) continue; // skip employees without a salary structure
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

/** Admin only. After this the run is locked (service check + DB trigger). */
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
    // notify every employee in this run: "Your payslip for {month} is ready"
    return after;
  });
}

/** Employees only see their own payslips, and only after finalization. */
export async function listPayslips(user: SessionUser) {
  const q = db.select({ slip: payslips, month: payrollRuns.month, status: payrollRuns.status })
    .from(payslips).innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId));
  if (user.role === "EMPLOYEE")
    return q.where(and(eq(payslips.employeeId, user.employeeId!), eq(payrollRuns.status, "finalized")));
  return q;
}
```

### Payslip PDF — `app/api/payslips/[id]/pdf/route.tsx`

```tsx
import { renderToBuffer, Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { eq } from "drizzle-orm";
import { withAuth } from "@/server/auth/guard";
import { db } from "@/server/db";
import { payslips, payrollRuns, employees } from "@/server/db/schema";
import { forbidden, notFound } from "@/server/errors";

export const runtime = "nodejs";

const st = StyleSheet.create({
  page: { padding: 32, fontSize: 11 },
  h1: { fontSize: 18, marginBottom: 12 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, borderBottom: "1 solid #eee" },
});

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
```

Add to `next.config.ts` if bundling complains: `serverExternalPackages: ["@react-pdf/renderer"]`.

---

## 11. Dashboards and analytics (M7)

All numbers come from the server. Filters: `from`, `to`, `departmentId`.

`services/analytics.service.ts`:

```ts
import { and, between, count, desc, eq, gte, inArray, lte, or, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { employees, attendance, leaveRequests, leaveTypes, departments, payslips, payrollRuns, salaryStructures } from "../db/schema";
import { SessionUser } from "../auth/session";
import { forbidden } from "../errors";
import { resolveDailyStatuses } from "./daily-status";
import { getSettings } from "./org.service";
import { nowIn, monthRange } from "../lib/dates";

export type Filters = { from?: string; to?: string; departmentId?: string };

async function defaults(f: Filters) {
  const s = await getSettings();
  const { date } = nowIn(s.timezone);
  const m = monthRange(date.slice(0, 7));
  return { from: f.from ?? m.start, to: f.to ?? m.end, departmentId: f.departmentId, today: date };
}

/** Ids visible to this user. Employee => only self. */
async function scopedIds(user: SessionUser, departmentId?: string) {
  if (user.role === "EMPLOYEE") return user.employeeId ? [user.employeeId] : [];
  const rows = await db.select({ id: employees.id }).from(employees)
    .where(and(inArray(employees.status, ["active", "probation"]), departmentId ? eq(employees.departmentId, departmentId) : undefined));
  return rows.map((r) => r.id);
}

export async function headcount(user: SessionUser, f: Filters = {}) {
  if (user.role === "EMPLOYEE") throw forbidden();
  const rows = await db.select({ department: departments.name, n: count() })
    .from(employees).innerJoin(departments, eq(departments.id, employees.departmentId))
    .where(and(inArray(employees.status, ["active", "probation"]), f.departmentId ? eq(employees.departmentId, f.departmentId) : undefined))
    .groupBy(departments.name);
  return { total: rows.reduce((a, r) => a + r.n, 0), byDepartment: rows };
}

export async function lateComers(user: SessionUser, f: Filters & { limit?: number } = {}) {
  if (user.role === "EMPLOYEE") throw forbidden();
  const d = await defaults(f);
  return db.select({
      employeeId: employees.id, code: employees.code,
      name: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
      lates: count(),
    })
    .from(attendance).innerJoin(employees, eq(employees.id, attendance.employeeId))
    .where(and(eq(attendance.isLate, true), between(attendance.date, d.from, d.to),
      d.departmentId ? eq(employees.departmentId, d.departmentId) : undefined))
    .groupBy(employees.id).orderBy(desc(count())).limit(f.limit ?? 5);
}

/** Attendance rate = (present + late + missing_checkout + 0.5·half_day) ÷ (working-day records − on_leave) */
export async function attendanceSummary(user: SessionUser, f: Filters = {}) {
  const d = await defaults(f);
  const ids = await scopedIds(user, d.departmentId);
  const { byEmployee } = await resolveDailyStatuses(ids, d.from, d.to);

  const c = { present: 0, late: 0, half_day: 0, missing_checkout: 0, absent: 0, on_leave: 0, unpaid_leave: 0 };
  for (const m of byEmployee.values()) for (const st of m.values()) c[st]++;

  const leaveDays = c.on_leave + c.unpaid_leave;
  const records = Object.values(c).reduce((a, b) => a + b, 0) - leaveDays;
  const attended = c.present + c.late + c.missing_checkout + 0.5 * c.half_day;
  return {
    from: d.from, to: d.to, ...c,
    attendanceRatePct: records ? +((attended / records) * 100).toFixed(1) : null,
    latePct: c.present + c.late ? +((c.late / (c.present + c.late)) * 100).toFixed(1) : null,
  };
}

export async function leaveSummary(user: SessionUser, f: Filters = {}) {
  const d = await defaults(f);
  const ids = await scopedIds(user, d.departmentId);
  if (!ids.length) return [];
  return db.select({ type: leaveTypes.code, days: sql<number>`coalesce(sum(${leaveRequests.days}),0)::int`, requests: count() })
    .from(leaveRequests).innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .where(and(inArray(leaveRequests.employeeId, ids), eq(leaveRequests.status, "approved"),
      lte(leaveRequests.startDate, d.to), gte(leaveRequests.endDate, d.from)))
    .groupBy(leaveTypes.code);
}

export async function onLeaveToday(user: SessionUser) {
  if (user.role === "EMPLOYEE") throw forbidden();
  const { today } = await defaults({});
  return db.select({ name: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`, type: leaveTypes.code })
    .from(leaveRequests).innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .where(and(eq(leaveRequests.status, "approved"), lte(leaveRequests.startDate, today), gte(leaveRequests.endDate, today)));
}

export async function payrollSummary(user: SessionUser, month: string) {
  if (user.role === "EMPLOYEE") throw forbidden();
  return db.select({
      department: departments.name, headcount: count(),
      gross: sql<number>`round(sum(${payslips.gross}),2)::float`, net: sql<number>`round(sum(${payslips.net}),2)::float`,
      avgGross: sql<number>`round(avg(${payslips.gross}),2)::float`,
    })
    .from(payslips).innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId))
    .innerJoin(employees, eq(employees.id, payslips.employeeId))
    .innerJoin(departments, eq(departments.id, employees.departmentId))
    .where(eq(payrollRuns.month, month)).groupBy(departments.name);
}

/** Attrition % = exits in period ÷ average headcount × 100 */
export async function attrition(user: SessionUser, f: Filters = {}) {
  if (user.role === "EMPLOYEE") throw forbidden();
  const d = await defaults(f);
  const [{ exits }] = await db.select({ exits: count() }).from(employees)
    .where(and(between(employees.exitDate, d.from, d.to), d.departmentId ? eq(employees.departmentId, d.departmentId) : undefined));
  const [{ start }] = await db.select({ start: count() }).from(employees)
    .where(and(lte(employees.joinDate, d.from), or(isNull(employees.exitDate), gte(employees.exitDate, d.from))));
  const [{ end }] = await db.select({ end: count() }).from(employees)
    .where(and(lte(employees.joinDate, d.to), or(isNull(employees.exitDate), gte(employees.exitDate, d.to))));
  const avg = (start + end) / 2;
  return { exits, averageHeadcount: avg, attritionPct: avg ? +((exits / avg) * 100).toFixed(1) : 0 };
}

/** The exact JSON the dashboard renders AND the AI summarizes. */
export async function hrKpis(user: SessionUser, f: Filters = {}) {
  if (user.role === "EMPLOYEE") throw forbidden();
  const d = await defaults(f);
  const [hc, att, late, leave, pending, today] = await Promise.all([
    headcount(user, f), attendanceSummary(user, f), lateComers(user, { ...f, limit: 5 }), leaveSummary(user, f),
    db.select({ n: count() }).from(leaveRequests).where(eq(leaveRequests.status, "pending")),
    db.select({ n: count() }).from(attendance).where(eq(attendance.date, d.today)),
  ]);
  return {
    filters: { from: d.from, to: d.to, departmentId: d.departmentId ?? null },
    headcount: hc, attendance: att, topLateComers: late, leaveByType: leave,
    pendingApprovals: pending[0].n, checkedInToday: today[0].n,
  };
}

export async function employeeKpis(user: SessionUser) {
  const att = await attendanceSummary(user, {});
  // + hours this week vs 40, leave balance (leaveService.getBalance), last payslip, announcements
  return { attendance: att };
}
```

Dashboard route handlers are thin:

```ts
// app/api/dashboard/hr/route.ts
export const GET = withAuth(["HR", "ADMIN"], async (req, _c, user) => {
  const q = Object.fromEntries(new URL(req.url).searchParams);
  const f = z.object({ from: z.string().date().optional(), to: z.string().date().optional(), departmentId: z.string().uuid().optional() }).parse(q);
  return Response.json(await analyticsService.hrKpis(user, f));
});
```

> Today is a Saturday in the brief's own date. `resolveDailyStatuses` skips weekends, but "checked in today" counts raw attendance rows, so a weekend demo still shows check-ins.

---

## 12. AI assistant (M8)

### Provider — `server/ai/provider.ts`

```ts
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { env } from "../env";

const google = createGoogleGenerativeAI({ apiKey: env.AI_API_KEY });
export const model = () => google(env.AI_MODEL);
```

### Rate limit and logging — `server/ai/limits.ts`

```ts
import { and, count, eq, gte } from "drizzle-orm";
import { db } from "../db";
import { aiLogs } from "../db/schema";
import { AppError } from "../errors";

export async function enforceRateLimit(userId: string, perHour = 20) {
  const since = new Date(Date.now() - 3_600_000);
  const [{ n }] = await db.select({ n: count() }).from(aiLogs).where(and(eq(aiLogs.userId, userId), gte(aiLogs.createdAt, since)));
  if (n >= perHour) throw new AppError(429, "RATE_LIMITED", "AI limit reached (20 per hour). Try again later.");
}

export async function logAi(e: { userId: string; kind: string; prompt: string; response?: string; toolsUsed?: string[]; latencyMs: number; error?: string }) {
  await db.insert(aiLogs).values(e);
}
```

### System prompt and policy Q&A — `server/ai/prompts.ts`

The rules from the brief's Section 3 go in verbatim.

```ts
import { SessionUser } from "../auth/session";
import { addDays, weekday } from "../lib/dates";

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

export function systemPrompt(user: SessionUser, today: string) {
  const scope =
    user.role === "ADMIN" ? "all company data"
    : user.role === "HR" ? "HR-level company data"
    : "ONLY the signed-in employee's own data";
  return `You are the HCM Lite assistant. Signed-in role: ${user.role}. You may use ${scope}.
Today is ${today} (${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][weekday(today)]}).

RULES
1. Answer data questions ONLY from tool results. Never invent numbers. If a tool returns nothing, say so.
2. Answer policy questions ONLY from the policy below. If it is not covered, say "I don't know".
3. Never reveal another employee's salary or personal data. If asked, politely refuse and explain you can only share their own data.
4. If no tool can answer because of the user's role, say you don't have access.
5. Be concise. Reply in the user's language, including Roman Urdu.
${POLICY}`;
}

/** Reference table so "next Monday" is computed by code, not guessed by the model. */
export function dateTable(today: string) {
  const names = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  return Array.from({ length: 21 }, (_, i) => {
    const d = addDays(today, i);
    return `${d} ${names[weekday(d)]}`;
  }).join("\n");
}
```

### Tools — `server/ai/tools.ts`

The scope is **closed over from the session**. The model never receives or supplies `employeeId` or `role`.

```ts
import { tool } from "ai";
import { z } from "zod";
import { SessionUser } from "../auth/session";
import * as analytics from "../services/analytics.service";
import * as leave from "../services/leave.service";
import * as employeeSvc from "../services/employee.service";
import { ilike } from "drizzle-orm";
import { db } from "../db";
import { departments } from "../db/schema";

const range = z.object({
  from: z.string().date().optional().describe("YYYY-MM-DD, defaults to start of this month"),
  to: z.string().date().optional().describe("YYYY-MM-DD, defaults to end of this month"),
  department: z.string().optional().describe("Department name"),
});

async function deptId(name?: string) {
  if (!name) return undefined;
  const [d] = await db.select().from(departments).where(ilike(departments.name, name));
  return d?.id;
}

export function buildTools(user: SessionUser) {
  const tools: Record<string, any> = {
    get_my_leave_balance: tool({
      description: "Remaining leave balance for the current user (annual, sick, casual).",
      inputSchema: z.object({ leaveType: z.enum(["annual", "sick", "casual"]).optional() }),
      execute: async ({ leaveType }) => user.employeeId
        ? leave.getBalance(user, user.employeeId, leaveType)
        : { error: "No employee profile for this account" },
    }),
  };

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
  return tools; // EMPLOYEE gets only get_my_leave_balance => "colleague's salary" is impossible
}
```

### Chat route — `app/api/ai/chat/route.ts`

```ts
import { generateText, stepCountIs } from "ai";
import { z } from "zod";
import { withAuth } from "@/server/auth/guard";
import { model } from "@/server/ai/provider";
import { buildTools } from "@/server/ai/tools";
import { systemPrompt } from "@/server/ai/prompts";
import { enforceRateLimit, logAi } from "@/server/ai/limits";
import { getSettings } from "@/server/services/org.service";
import { nowIn } from "@/server/lib/dates";

const body = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(2000) })).min(1).max(20),
});

export const maxDuration = 30;

export const POST = withAuth(["ADMIN", "HR", "EMPLOYEE"], async (req, _c, user) => {
  await enforceRateLimit(user.id);
  const { messages } = body.parse(await req.json());
  const last = messages[messages.length - 1].content;
  const { date } = nowIn((await getSettings()).timezone);
  const t0 = Date.now();

  try {
    const res = await generateText({
      model: model(),
      system: systemPrompt(user, date),
      messages,
      tools: buildTools(user),
      stopWhen: stepCountIs(4),
      abortSignal: AbortSignal.timeout(15_000),
    });
    const toolsUsed = res.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName));
    await logAi({ userId: user.id, kind: "chat", prompt: last, response: res.text, toolsUsed, latencyMs: Date.now() - t0 });
    return Response.json({ answer: res.text, label: "AI-generated" });
  } catch (e: any) {
    await logAi({ userId: user.id, kind: "chat", prompt: last, latencyMs: Date.now() - t0, error: String(e?.message ?? e) });
    return Response.json({ answer: "The assistant is unavailable right now. Please try again shortly.", label: "AI-generated", degraded: true });
  }
});
```

### Dashboard summary — `app/api/ai/summary/route.ts`

```ts
export const POST = withAuth(["ADMIN", "HR"], async (req, _c, user) => {
  await enforceRateLimit(user.id);
  const f = filtersSchema.parse(await req.json());
  const kpis = await analytics.hrKpis(user, f);              // same JSON the dashboard shows
  const t0 = Date.now();
  try {
    const { text } = await generateText({
      model: model(),
      abortSignal: AbortSignal.timeout(15_000),
      system: "You write 3 to 5 short insight bullets for an HR dashboard. Use ONLY numbers present in the JSON. Do not invent figures. If data is sparse, say so.",
      prompt: JSON.stringify(kpis),
    });
    await logAi({ userId: user.id, kind: "summary", prompt: JSON.stringify(f), response: text, latencyMs: Date.now() - t0 });
    return Response.json({ summary: text, label: "AI-generated" });
  } catch (e: any) {
    await logAi({ userId: user.id, kind: "summary", prompt: JSON.stringify(f), latencyMs: Date.now() - t0, error: String(e?.message) });
    return Response.json({ summary: null, label: "AI-generated", degraded: true });
  }
});
```

For the Admin dashboard, swap `hrKpis` for an `adminKpis` that adds attrition and payroll cost.

### Smart leave — `app/api/ai/smart-leave/route.ts`

```ts
import { generateObject } from "ai";
import { z } from "zod";
import { dateTable } from "@/server/ai/prompts";
import * as leave from "@/server/services/leave.service";

const LeaveDraft = z.object({
  type: z.enum(["annual", "sick", "casual", "unpaid"]),
  start: z.string().date(),
  end: z.string().date(),
  reason: z.string().max(200),
});

export const POST = withAuth(["EMPLOYEE"], async (req, _c, user) => {
  await enforceRateLimit(user.id);
  const { text } = z.object({ text: z.string().min(3).max(500) }).parse(await req.json());
  const { date } = nowIn((await getSettings()).timezone);
  const t0 = Date.now();

  let draft: z.infer<typeof LeaveDraft> | null = null;
  for (let attempt = 0; attempt < 2 && !draft; attempt++) {       // validate, retry once
    try {
      const { object } = await generateObject({
        model: model(), schema: LeaveDraft, abortSignal: AbortSignal.timeout(15_000),
        system: `Convert the employee's request into a leave draft.
Today is ${date}. Use ONLY these calendar dates when resolving words like "next Monday":
${dateTable(date)}
Rules: weddings, family events, personal errands => casual. Illness => sick. Planned holiday/vacation => annual. If unclear use casual.
"next Monday" means the first Monday of the NEXT calendar week. Output only the fields.`,
        prompt: text,
      });
      if (object.end >= object.start) draft = object;
    } catch { /* retry */ }
  }
  await logAi({ userId: user.id, kind: "smart_leave", prompt: text, response: JSON.stringify(draft), latencyMs: Date.now() - t0, error: draft ? undefined : "parse_failed" });

  if (!draft) return Response.json({ draft: null, fallback: true, label: "AI-generated" }); // UI shows normal form

  // Dry-run the real rules so the form can warn. NOTHING is saved here.
  let warning: string | null = null;
  let days: number | null = null;
  try { ({ days } = await leave.validate(user.employeeId!, draft.type, draft.start, draft.end)); }
  catch (e: any) { warning = e.message; }
  return Response.json({ draft, days, warning, label: "AI-generated" });
});
```

Frontend flow: pre-fill the leave form with `draft`, show the `warning` if present, and let the user confirm. The confirm button calls the normal `POST /api/leave`, which re-validates everything.

### AI chat panel (frontend)

```tsx
"use client";
import { useState } from "react";

export function AiPanel() {
  const [msgs, setMsgs] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    const next = [...msgs, { role: "user" as const, content: input }];
    setMsgs(next); setInput(""); setBusy(true);
    const res = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: next }) });
    const data = await res.json();
    setMsgs([...next, { role: "assistant", content: data.answer ?? data.error?.message ?? "Error" }]);
    setBusy(false);
  }

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div className="flex-1 space-y-2 overflow-auto">
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : ""}>
            <div className="inline-block rounded-lg bg-muted px-3 py-2 text-sm">{m.content}</div>
            {m.role === "assistant" && <div className="text-[10px] text-muted-foreground">AI-generated</div>}
          </div>
        ))}
        {busy && <div className="text-sm text-muted-foreground">Thinking…</div>}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); if (input.trim() && !busy) send(); }} className="flex gap-2">
        <input value={input} onChange={(e) => setInput(e.target.value)} className="flex-1 rounded border px-2 py-1" placeholder="Ask about your data…" />
        <button className="rounded bg-primary px-3 text-primary-foreground" disabled={busy}>Send</button>
      </form>
    </div>
  );
}
```

### AI guardrail checklist

- [ ] `AI_API_KEY` only in env, never `NEXT_PUBLIC_*`; the browser only calls `/api/ai/*`
- [ ] Tools reuse the same services and permission checks as the REST API
- [ ] Employee toolset has no salary or other-employee tool
- [ ] AI never writes; smart leave only returns a draft; the confirm step calls the normal API
- [ ] 15 s timeout (`AbortSignal.timeout`) with a friendly fallback message
- [ ] About 20 requests per user per hour, counted from `ai_logs`
- [ ] Every call logged in `ai_logs` (prompt, tools, latency, error)
- [ ] "AI-generated" label on every answer
- [ ] JSON output validated with Zod, retried once, then fallback to the normal form

### Live judge questions to test

| As | Question | Expected |
|---|---|---|
| HR | How many active employees are in {department}? | Same number as dashboard |
| HR | Who came late most often this month? | Matches top late-comers list |
| HR | What is this month's attendance rate? | Matches dashboard rate |
| Employee | How many sick leaves do I have left this year? | 8 − approved/pending sick days |
| Employee | What is {colleague}'s salary? | Polite refusal |
| Employee | I need next Monday and Tuesday off for my sister's wedding | Casual leave, correct dates |

---

## 13. Comms and audit (M9)

```ts
// announcements: Admin + HR post, everyone reads (shown on every dashboard)
export const POST = withAuth(["ADMIN", "HR"], async (req, _c, user) => {
  const input = z.object({ title: z.string().min(2), body: z.string().min(2) }).parse(await req.json());
  const [a] = await db.insert(announcements).values({ ...input, postedBy: user.id }).returning();
  await audit(db, user, "announcement.post", "announcement", a.id, null, a);
  return Response.json(a, { status: 201 });
});
export const GET = withAuth(["ADMIN", "HR", "EMPLOYEE"], async () =>
  Response.json(await db.select().from(announcements).orderBy(desc(announcements.createdAt)).limit(20)));

// notifications: own only
export const GET_NOTIFS = withAuth(["ADMIN", "HR", "EMPLOYEE"], async (_r, _c, user) =>
  Response.json(await db.select().from(notifications).where(eq(notifications.userId, user.id)).orderBy(desc(notifications.createdAt)).limit(50)));

// audit log: Admin only, read-only. There is no PUT/DELETE route, and a DB trigger blocks updates.
export const GET_AUDIT = withAuth(["ADMIN"], async (req) => {
  const page = Number(new URL(req.url).searchParams.get("page") ?? 1);
  return Response.json(await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(50).offset((page - 1) * 50));
});
```

(Export each as its own `route.ts`. They are grouped here for brevity.)

Things that **must** write an audit row: setup, login, user create/deactivate/reset, employee register/edit, salary change, leave apply/cancel/approve/reject, correction approve/reject, payroll draft/finalize, settings change, announcements.

---

## 14. Optional / bonus

### Camera attendance with geofence (+10)

Server decides; the client only sends data. Reject if no face, more than one face, outside radius, or GPS accuracy worse than 100 m.

```ts
// server/lib/geo.ts
export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export async function assertInsideOffice(
  s: { officeLat: number | null; officeLng: number | null; officeRadiusM: number },
  g: { lat?: number; lng?: number; accuracy?: number },
) {
  if (s.officeLat == null || s.officeLng == null) throw unprocessable("Office location is not configured");
  if (g.lat == null || g.lng == null) throw unprocessable("Location is required");
  if ((g.accuracy ?? Infinity) > 100) throw unprocessable("GPS accuracy is worse than 100 m");
  if (haversineM(s.officeLat, s.officeLng, g.lat, g.lng) > s.officeRadiusM) throw unprocessable("You are outside the office area");
}
```

Client (web): use `@vladmandic/face-api` or `@mediapipe/tasks-vision` in a client component, require exactly one detected face, then send `{ lat, lng, accuracy, source: "camera" }`. Do not store the photo.

### Late penalty rule (3 lates = 0.5 day)

Inside `computePayslip`, count `isLate` days (add `lateDays` to `PayslipInput`) and add:

```ts
const latePenaltyDays = Math.floor(lateDays / 3) * 0.5;
const deductDays = ineligible + absent + unpaid + 0.5 * half + latePenaltyDays;
```

### Other cheap bonuses

- **Roman Urdu:** already in the system prompt (rule 5).
- **Dark mode:** `next-themes` + shadcn.
- **Absence anomaly flag:** flag employees with 3 or more absences on Mondays or Fridays in the period, from `resolveDailyStatuses`.
- **Attrition risk score:** simple weighted score from late %, absent days and leave use; display as Low/Medium/High.

---

## 15. Tests (Vitest)

`tests/payroll.test.ts`:

```ts
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
```

`tests/dates.test.ts`:

```ts
import { workingDays, addDays } from "@/server/lib/dates";
it("skips Sat/Sun and holidays", () => {
  // 2026-10-26 is a Monday
  const d = workingDays("2026-10-26", "2026-11-01", [0, 6], new Set(["2026-10-28"]));
  expect(d).toEqual(["2026-10-26", "2026-10-27", "2026-10-29", "2026-10-30"]);
});
```

Also test with a real DB (or pglite): second check-in returns 409, overlap and over-balance return 422, Employee cannot read another employee (403), Employee calling `/api/payroll` gets 403, HR calling finalize gets 403.

---

## 16. Deployment

1. Create a Neon project, copy the pooled connection string into `DATABASE_URL`.
2. Run migrations once: `DATABASE_URL=... bunx drizzle-kit migrate` (includes the custom trigger migrations).
3. Push the repo to GitHub (public, or share with judges).
4. Import into Vercel; set `DATABASE_URL`, `JWT_SECRET`, `AI_API_KEY`, `AI_MODEL` in Environment Variables.
5. Deploy and open the live link. It must land on **/setup** (empty DB).
6. Before submitting, wipe the DB (`drizzle-kit push --force` on a fresh database, or drop and re-migrate) so judges get a clean first run.

### README outline

```md
# HCM Lite
Stack · Live demo link · Screens
## Run locally
1. cp .env.example .env  2. bun install  3. bunx drizzle-kit migrate  4. bun dev
## First Admin
Open /setup, or set ADMIN_EMAIL / ADMIN_PASSWORD / COMPANY_NAME in .env.
## AI key
Set AI_API_KEY (Gemini free tier) and AI_MODEL. Server-side only.
## Roles & flows
Admin → HR → Employee walkthrough.
## Done / Not done
Checklist of the 25 functionalities + bonuses.
## Tests
bun run test
```

---

## 17. Build checklist (25 functionalities)

| # | Functionality | Service | Done |
|---|---|---|---|
| 01 | First-run setup | setup | ☐ |
| 02 | Login/logout/change password, role menus | auth, guard | ☐ |
| 03 | Company settings | org | ☐ |
| 04 | Departments, designations, leave types, holidays | org | ☐ |
| 05 | HR logins, deactivate/reset | org/users | ☐ |
| 06 | Register employee + edit | employee | ☐ |
| 07 | Directory, search, Employee 360 | employee | ☐ |
| 08 | CSV import (dry run) + export | employee | ☐ |
| 09 | Web check-in/out | attendance | ☐ |
| 10 | Calendar + daily board | attendance, daily-status | ☐ |
| 11 | Corrections | attendance | ☐ |
| 12 | Apply/cancel leave, balance | leave | ☐ |
| 13 | Approve/reject leave | leave | ☐ |
| 14 | Salary structure | payroll | ☐ |
| 15 | Payroll draft | payroll | ☐ |
| 16 | Finalize payroll (Admin) | payroll | ☐ |
| 17 | Payslip PDF | payroll + pdf route | ☐ |
| 18 | Dashboards with filters | analytics | ☐ |
| 19 | AI chat | ai/tools | ☐ |
| 20 | AI dashboard summary | ai/summary | ☐ |
| 21 | Smart leave | ai/smart-leave | ☐ |
| 22 | Policy Q&A | ai/prompts | ☐ |
| 23 | Announcements | comms | ☐ |
| 24 | Notifications | comms | ☐ |
| 25 | Audit log | audit | ☐ |

## 18. Known gotchas

- **Weekend check-ins:** the hackathon date (24 Oct 2026) is a Saturday. Do not reject weekend check-ins; just exclude weekend days from absent and attendance-rate maths.
- **Timezone:** compute "today" with `nowIn(settings.timezone)` (default `Asia/Karachi`). Never use `new Date().toISOString().slice(0,10)` for office dates.
- **`inArray` with an empty array** can throw in some drizzle versions. Guard with `if (!ids.length)`.
- **Next.js 15+:** `cookies()` and route `params` are async (`await ctx.params`).
- **Neon pooling:** `prepare: false` is set in the `postgres` client for pooled connections.
- **Salary and role in the AI:** never pass `employeeId`/role as a tool argument. Close over the session user.
- **Payroll "today":** absent days are only counted for days before today, so a draft run mid-month does not penalize future days.
- **Tax assumption:** tax is computed on the full monthly gross × 12 (÷ 12 per month), not on the prorated amount. State this in the README.


# UI 


PROJECT: HCM Lite — an AI-assisted Human Capital Management web app for three roles (Admin, HR, Employee). Design a complete, responsive (desktop-first, works down to 375px) multi-page UI. Do NOT use lorem ipsum or fake company data in finished states. The product starts EMPTY, so every screen needs a designed empty state, a loading skeleton and an error state.

DESIGN PERSONALITY
"Warm editorial meets precise data tool." It should feel like a well-set printed ledger crossed with a modern dashboard: calm, trustworthy, a little distinctive. No generic purple-gradient SaaS look. No glassmorphism. Flat surfaces, hairline borders, generous whitespace, tight data density only inside tables and charts.

TYPOGRAPHY (use exactly these, via Google Fonts in Framer)
- Display / headings: "Bricolage Grotesque" (600–700). Tight tracking (-2%). Used for page titles, KPI labels and hero text.
- Body / UI: "Instrument Sans" (400/500/600), 15px base, 1.55 line-height.
- Numbers, IDs, times, payroll figures, table numerics: "JetBrains Mono" (500), tabular figures. Every KPI value and money amount is mono.
- Scale: 12 / 14 / 15 / 18 / 24 / 32 / 48 / 72. Page title 32 display. KPI value 48 mono. Small caps labels (12px, +8% tracking, uppercase) for section eyebrows and table headers.

COLOR SYSTEM ("Ink & Saffron")
Light mode:
- Paper (app background): #F6F2EA
- Surface (cards): #FFFFFF with 1px border #E4DDCF
- Ink (primary text): #14181F, Muted text: #5E6672
- Pine (primary brand, buttons, sidebar): #0F3D3A
- Teal (HR role accent, positive): #1B9C85
- Saffron (Employee role accent, highlights): #F2A33A
- Lilac (ONLY for AI features): #7C6CF2 with tint #ECE9FD
- Coral (late, errors, destructive): #E4572E
- Moss (present/approved): #3E8E5A
Dark mode (include as a toggle): background #0C1211, surface #141C1B, border #24312F, text #EDEAE2, same accents slightly lightened.
Role identity: Admin = Pine, HR = Teal, Employee = Saffron. The active role color tints the sidebar highlight, the top-bar underline and the primary buttons.
Status chips (pill, tinted bg + solid text): Present = Moss, Late = Saffron, Absent = Coral, Half-day = Teal, On leave = Lilac-gray, Missing checkout = Ink outline, Pending = Saffron outline, Approved = Moss, Rejected = Coral, Finalized = Pine with a lock icon.

SIGNATURE PATTERN
A subtle "ledger grid" texture: a 1px dotted grid at 4% opacity on the Paper background, plus a quarter-circle Pine/Teal shape bleeding off one corner of hero and auth panels. Section headers get a short 24px saffron rule above the eyebrow text. Cards use 14px radius, no shadows except a 1px offset hard shadow (#14181F at 8%) on hover. AI surfaces are always Lilac-tinted with a small "AI-generated" tag.

GLOBAL APP SHELL (reuse on every logged-in page)
- Left sidebar 248px, Pine background, collapsible to 72px icon rail. Logo mark top-left, role badge under it, role-specific menu, user chip + logout at the bottom.
- Top bar: breadcrumb, global search, date-range picker, notification bell with a count badge, dark-mode toggle, avatar menu.
- Right-side AI assistant drawer (Lilac), opened from a floating "Ask assistant" button on every page.
- Content max-width 1280px, 24px gutters, 8px spacing grid.
- Role menus:
  Admin: Dashboard, Organization, Users, Employees, Attendance, Leave, Payroll, Announcements, Audit Log
  HR: Dashboard, Employees, Attendance, Corrections, Leave Inbox, Payroll, Announcements
  Employee: My Dashboard, Check-in, My Attendance, My Leave, Payslips, Profile, Announcements

PAGES (design each as its own frame, desktop + mobile variants)

1. LANDING (public, simple): Hero with big Bricolage headline "HR that answers back.", subline, "Sign in" and "Set up company" buttons, the corner quarter-circle and ledger grid. Below: a 3-column role section (Admin, HR, Employee, each with its role color), a 9-module bento grid, a compact footer.

2. FIRST-RUN SETUP (public, one-time): Split screen. Left Pine panel with a 3-step progress rail (Company, Admin account, Done). Right: form with company name, admin name, email, password plus strength meter. Success state with a confetti-free subtle check animation.

3. LOGIN: Split screen, email + password, show/hide password, error banner, "Forgot? Ask your admin" note. Role is not chosen here; it is detected after login.

4. CHANGE PASSWORD (forced on first sign-in): Centered card, "Set your own password" with requirements checklist that ticks live. Blocks navigation until done.

5. ADMIN DASHBOARD: Top row of 4 KPI cards (Headcount, Attrition YTD, Payroll cost, Avg salary), big mono numbers, small delta chips. Filter bar (date range + department). Row: "Headcount by department" horizontal bars, "Payroll cost by department" stacked bars. Row: gender donut, tenure histogram, audit feed list. Lilac "AI Summary" card with a Summarize button producing 3–5 bullets. Announcements strip at the top.

6. HR DASHBOARD: KPIs (Headcount, Present, On leave, Late today, Pending approvals). Attendance trend line chart, absenteeism by department, leave by type donut, Top 5 late-comers table, quick-action buttons (Register employee, Review leave, Run payroll), AI Summary card.

7. EMPLOYEE DASHBOARD: Large check-in widget (live clock in mono, Check in / Check out button, status chip, hours today). Hours this week vs 40h progress bar, late count, leave balance mini-rings per type, last payslip card, announcements, "Ask my assistant" prompt chips.

8. ORGANIZATION SETUP (Admin; tabs): Company & Rules (office start 09:00, grace 15 min, half-day under 5h, weekend, office location + radius field with a placeholder map card), Departments, Designations, Leave types & quotas (annual 14 / sick 8 / casual 10 / unpaid), Public holidays (calendar + list). Each tab has an add/edit side-panel. HR sees the same page read-only.

9. USERS (Admin): table of HR/employee logins with role chips, active toggle, "Reset password" and "Create HR login" modal.

10. EMPLOYEE DIRECTORY (Admin, HR; Employees see only their own): Search, filter chips (department, status, designation), paged table, avatar + name + code (mono) + status, row click opens Employee 360. Buttons: Register employee, Import CSV, Export CSV.

11. REGISTER / EDIT EMPLOYEE: Multi-section form (Personal, Job details, Salary basics, Login preview showing "temporary password will be generated"). Sticky save bar.

12. CSV IMPORT: 3-step flow (Upload, Dry-run report, Confirm). The dry-run report is a table with Row / Field / Reason columns, Coral rows for errors, a summary strip (valid vs invalid rows), and "Import valid rows" disabled until the errors are fixed.

13. EMPLOYEE 360: Header card (photo, name, designation, department, status), tabs: Overview, Attendance, Leave, Payroll, Documents. Salary tab is hidden from Employees. Include a mini attendance heat calendar.

14. CHECK-IN / MY ATTENDANCE (Employee): Check-in card plus a month calendar where each day is color-coded by the status chips, a day detail drawer, and a "Request correction" form (date, reason, proposed times).

15. ATTENDANCE BOARD (Admin, HR): Daily board table (employee, check-in, check-out, hours mono, status chip, source), date picker, department filter, summary chips at the top. Corrections tab: request cards with Approve / Reject + comment.

16. MY LEAVE (Employee): Balance rings (annual, sick, casual), history table with status chips and a cancel action. "Apply leave" opens a form with a Lilac "Smart leave" input at the top: a sentence box, then fields auto-fill (type, start, end, working-day count, reason) with a "Please confirm" notice. Show inline 422 error states for overlap and over-balance.

17. LEAVE INBOX (HR; Admin view-only): Pending list as cards (who, type, dates, days, reason, balance after), Approve/Reject buttons that require a comment, history tab.

18. PAYROLL (Admin, HR): Tabs: Salary structures (table: basic, HRA 40%, medical 10%, gross computed in mono), Monthly run (month picker, "Create draft" button, a table with per-employee gross, deductions, tax, net, a totals footer), Finalize action (Admin only) with a confirmation modal and a locked-state banner afterwards (Pine, lock icon, no edit controls).

19. PAYSLIPS: List by month for the Employee; a printable payslip detail page (company header, earnings and deductions columns, net pay in large mono, Download PDF button).

20. AI ASSISTANT DRAWER: Lilac header "Assistant · AI-generated", chat bubbles, tool-use indicator ("Checking attendance…"), suggested prompt chips per role, a polite-refusal state ("I can't share other employees' salaries"), rate-limit and timeout fallback states.

21. ANNOUNCEMENTS & NOTIFICATIONS: Announcement composer (Admin, HR) and feed cards; a notification dropdown + full page list with read/unread dots (leave decisions, payslips).

22. AUDIT LOG (Admin only): Dense table (time mono, actor, action chip, entity, expand-row showing before/after JSON in a split diff view), filters, read-only, no delete controls.

23. PROFILE: View own details, edit phone and address only, change password section.

24. SYSTEM STATES: 403 "Not for your role", 404, global error, session expired, a generic empty-state illustration style (simple line drawings in Ink with one saffron accent), and skeleton loaders for tables and charts.

COMPONENTS TO BUILD AS REUSABLE VARIANTS
Buttons (primary / secondary / ghost / destructive, sizes), inputs with error and helper text, select, date range, tabs, status chips, KPI card, chart cards (bar, line, donut with tooltips), data table (sticky header, row hover, paging, empty row), side-panel, modal, toast, confirmation dialog, avatar, calendar day cell, stepper, banner (info / success / locked), AI card and tag.

MOTION
Subtle only: 150–200ms ease-out for hovers and drawers, chart bars grow in once, number count-up on KPI load, no parallax.

ACCESSIBILITY
WCAG AA contrast, visible focus rings (2px Lilac outline offset 2px), never rely on color alone for status (always an icon or label), 44px minimum tap targets.

OUTPUT
Organize frames per page in the order above, with a Design System page first (colors, type, components) and a Flow overview page last showing Admin → HR → Employee journeys. Keep naming consistent (e.g. "Admin/Dashboard", "HR/Leave Inbox").