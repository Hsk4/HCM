import {
  pgTable, pgEnum, uuid, text, integer, boolean, timestamp, date,
  numeric, jsonb, doublePrecision, uniqueIndex, index,
} from "drizzle-orm/pg-core";

/**
 * @fileoverview Database schema — the single source of truth for tables.
 *
 * @description
 * Every table is declared once here and consumed by both the application
 * (`db/index.ts`) and the migration generator (`drizzle.config.ts`). The schema
 * intentionally encodes the business *rules* that must hold at the storage
 * layer, so they cannot be bypassed by a bug in a service:
 *
 *  - one attendance row per employee per day  → `att_emp_date_uq`
 *  - one payslip per employee per run        → `slip_run_emp_uq`
 *  - one payroll run per month               → `payroll_runs.month` unique
 *  - one leave type code / department name   → unique columns
 *  - finalized payroll is immutable          → enforced in the service layer
 *
 * Money is `numeric(12,2)` returned as a JS number; every payslip also stores
 * its computed `breakdown` JSON so a paid slip is reproducible even if the tax
 * slabs change later.
 *
 * @implementation
 *
 * Step 1: Declare enums used by more than one table.
 * Step 2: Declare shared column factories (`id`, `createdAt`).
 * Step 3: Declare tables in dependency order (org → people → time → pay → ops).
 * Step 4: Add unique/composite indexes for the invariants above.
 * Step 5: Export the `schema` barrel for Drizzle.
 * Step 6: Generate migrations with `bunx drizzle-kit generate`, then apply with
 *         `bunx drizzle-kit migrate` against the unpooled URL.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

// ───────── Step 1: enums ─────────
export const roleEnum = pgEnum("role", ["ADMIN", "HR", "EMPLOYEE"]);
export const empStatusEnum = pgEnum("emp_status", ["probation", "active", "exited"]);
export const attStatusEnum = pgEnum("att_status", ["present", "late", "half_day"]);
export const attSourceEnum = pgEnum("att_source", ["web", "camera", "correction"]);
export const reqStatusEnum = pgEnum("req_status", ["pending", "approved", "rejected", "cancelled"]);
export const payrollStatusEnum = pgEnum("payroll_status", ["draft", "finalized"]);

// ───────── Step 2: shared column factories ─────────

/** Primary key: server-generated UUIDv4, so no sequence coordination. */
const id = () => uuid("id").primaryKey().defaultRandom();
/** Creation timestamp with timezone — audit ordering and AI rate limiting. */
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// ───────── Step 3a: M1/M2 auth + organization ─────────
/** A login. Role decides what the session may read and write. */
export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull(),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
});

/** The single company row (`id = 1`). Absent means first-run setup is needed. */
export const settings = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  companyName: text("company_name").notNull(),
  officeStart: text("office_start").notNull().default("09:00"),
  graceMinutes: integer("grace_minutes").notNull().default(15),
  halfDayMinutes: integer("half_day_minutes").notNull().default(300), 
  weekendDays: integer("weekend_days").array().notNull().default([0, 6]), 
  officeLat: doublePrecision("office_lat"),
  officeLng: doublePrecision("office_lng"),
  officeRadiusM: integer("office_radius_m").notNull().default(150),
  timezone: text("timezone").notNull().default("Asia/Karachi"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ───────── Step 3b: org lookup tables ─────────
/** Departments; the UNIQUE name is what filters and AI tools match on. */
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
  code: text("code").notNull().unique(),        
  name: text("name").notNull(),
  yearlyQuota: integer("yearly_quota"),         
  isPaid: boolean("is_paid").notNull().default(true),
});

export const holidays = pgTable("holidays", {
  id: id(),
  date: date("date", { mode: "string" }).notNull().unique(),
  name: text("name").notNull(),
});

// ───────── Step 3c: M3 employees ─────────
/** Employee profile. Exactly one per user (`user_id` unique) and one code per employee. */
export const employees = pgTable("employees", {
  id: id(),
  code: text("code").notNull().unique(),         
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

// ───────── Step 3d: M4 attendance ─────────
/** One attendance row per employee per day (enforced by `att_emp_date_uq`). */
export const attendance = pgTable("attendance", {
  id: id(),
  employeeId: uuid("employee_id").notNull().references(() => employees.id),
  date: date("date", { mode: "string" }).notNull(),           
  checkIn: timestamp("check_in", { withTimezone: true }).notNull(),
  checkOut: timestamp("check_out", { withTimezone: true }),
  status: attStatusEnum("status").notNull().default("present"),
  isLate: boolean("is_late").notNull().default(false),        
  workedMinutes: integer("worked_minutes"),
  source: attSourceEnum("source").notNull().default("web"),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  accuracyM: doublePrecision("accuracy_m"),
}, (t) => [
  uniqueIndex("att_emp_date_uq").on(t.employeeId, t.date),    
  index("att_date_idx").on(t.date),
]);

export const attendanceCorrections = pgTable("attendance_corrections", {
  id: id(),
  employeeId: uuid("employee_id").notNull().references(() => employees.id),
  date: date("date", { mode: "string" }).notNull(),
  requestedCheckIn: text("requested_check_in"),               
  requestedCheckOut: text("requested_check_out"),
  reason: text("reason").notNull(),
  status: reqStatusEnum("status").notNull().default("pending"),
  decidedBy: uuid("decided_by").references(() => users.id),
  decisionComment: text("decision_comment"),
  createdAt: createdAt(),
});

// ───────── Step 3e: M5 leave ─────────
/** Leave applications. `days` is the pre-computed working-day count. */
export const leaveRequests = pgTable("leave_requests", {
  id: id(),
  employeeId: uuid("employee_id").notNull().references(() => employees.id),
  leaveTypeId: uuid("leave_type_id").notNull().references(() => leaveTypes.id),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  days: integer("days").notNull(),                            
  reason: text("reason"),
  status: reqStatusEnum("status").notNull().default("pending"),
  decidedBy: uuid("decided_by").references(() => users.id),
  decisionComment: text("decision_comment"),
  createdAt: createdAt(),
}, (t) => [index("leave_emp_idx").on(t.employeeId, t.startDate)]);

// ───────── Step 3f: M6 payroll ─────────
/** Salary history per employee; the newest `effective_from` at run time wins. */
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
  month: text("month").notNull().unique(),                    
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
  ineligibleDays: integer("ineligible_days").notNull().default(0), 
  deduction: numeric("deduction", { precision: 12, scale: 2, mode: "number" }).notNull(),
  tax: numeric("tax", { precision: 12, scale: 2, mode: "number" }).notNull(),
  net: numeric("net", { precision: 12, scale: 2, mode: "number" }).notNull(),
  breakdown: jsonb("breakdown").notNull(),                    
}, (t) => [uniqueIndex("slip_run_emp_uq").on(t.runId, t.employeeId)]);

// ───────── Step 3g: M9 comms, audit, AI ─────────
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
  action: text("action").notNull(),                           
  entity: text("entity").notNull(),                           
  entityId: text("entity_id"),
  before: jsonb("before"),
  after: jsonb("after"),
  createdAt: createdAt(),
}, (t) => [index("audit_created_idx").on(t.createdAt)]);

export const aiLogs = pgTable("ai_logs", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  kind: text("kind").notNull(),                               
  prompt: text("prompt").notNull(),
  response: text("response"),
  toolsUsed: text("tools_used").array(),
  latencyMs: integer("latency_ms"),
  error: text("error"),
  createdAt: createdAt(),
}, (t) => [index("ailog_user_idx").on(t.userId, t.createdAt)]);

/**
 * Barrel of every table, passed to `drizzle(client, { schema })` in ./index.ts
 * so the db instance knows the full table registry (and enables
 * `db.query.<table>` relational helpers).
 *
 * Step 5: keep this list in sync whenever a table is added — a missing entry
 * silently disables relational queries but does not break plain selects.
 */
export const schema = {
  users, settings, departments, designations, leaveTypes, holidays,
  employees, attendance, attendanceCorrections, leaveRequests,
  salaryStructures, payrollRuns, payslips,
  announcements, notifications, auditLogs, aiLogs,
};