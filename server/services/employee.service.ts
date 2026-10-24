/**
 * @fileoverview Employee records: registration, listing, 360 view, CSV import.
 *
 * @description
 * Registering an employee is a four-part transaction that must never half
 * succeed: create the login (with a temporary password and a forced change),
 * create the employee row (with a generated `EMP-0001` code), seed the salary
 * structure, and notify the new user. A duplicate email or code rolls the whole
 * thing back.
 *
 * The CSV importer runs the same rules row-by-row and is all-or-nothing: if any
 * row is invalid, nothing is written, so HR can fix the file and re-upload
 * instead of reconciling a partial import.
 *
 * @implementation
 *
 * Step 1: Schemas — `registerSchema` (single) and `rowSchema` (CSV row).
 * Step 2: `nextCode` derives the next `EMP-####` code inside the transaction.
 * Step 3: `register` — dedupe, hash temp password, insert user → employee →
 *         salary → notify, and audit the whole registration.
 * Step 4: `list` — paginated, searchable; employees can only see themselves.
 * Step 5: `get360` — full profile, with salary for HR/Admin only.
 * Step 6: `importCsv` — validate all rows, abort on any error, otherwise insert.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

// ── Step 1: dependencies and schemas ──────────────────────────────────────────
import { and, count, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import type { Tx } from "../db";
import { users, employees, salaryStructures, departments } from "../db/schema";
import { hashPassword, tempPassword } from "../auth/password";
import { SessionUser } from "../auth/session";
import { conflict, forbidden, notFound } from "../errors";
import { audit, notify } from "../lib/audit";
import Papa from "papaparse";

/** Validation for registering one employee. */
export const registerSchema = z.object({
  email: z.email(),
  firstName: z.string().min(1), lastName: z.string().min(1),
  departmentId: z.uuid(),
  designationId: z.uuid().optional(),
  joinDate: z.iso.date(),
  basicSalary: z.number().positive(),
  phone: z.string().optional(), address: z.string().optional(), gender: z.string().optional(),
  status: z.enum(["probation", "active"]).default("active"),
});
export type RegisterInput = z.infer<typeof registerSchema>;

// ── Step 2: employee code generation ──────────────────────────────────────────

/**
 * Derives the next employee code from the current row count.
 *
 * @param tx The open transaction (counting inside it keeps the sequence stable).
 * @returns A code such as `EMP-0007`.
 * @note Not concurrency-proof on its own; the unique index on `code` is the
 *       real guarantee, and a collision surfaces as a constraint error.
 */
async function nextCode(tx: Tx) {
  const [{ n }] = await tx.select({ n: count() }).from(employees);
  return `EMP-${String(n + 1).padStart(4, "0")}`;
}

// ── Step 3: registration ──────────────────────────────────────────────────────

/**
 * Registers an employee with a login, salary structure and welcome notification.
 *
 * @param user  The HR user performing the registration (HR only).
 * @param input Validated registration input.
 * @returns `{ employee, login: { email, temporaryPassword } }` — the temporary
 *          password is returned once so HR can hand it over.
 * @throws 403 for non-HR; 409 when the email is already registered.
 */
export async function register(user: SessionUser, input: RegisterInput) {
  // ADMIN is allowed too: the admin employee directory offers registration, and
  // the routes wrap HR-only / HR+ADMIN differently. Previously this threw 403
  // for ADMIN, so the button appeared to work but always failed.
  if (user.role !== "HR" && user.role !== "ADMIN") throw forbidden("Only HR or Admin registers employees");
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
    return { employee: e, login: { email, temporaryPassword: temp } };
  });
}

// ── Step 4: listing ───────────────────────────────────────────────────────────

/** Query validation for `list`: search, filters and pagination. */
export const listSchema = z.object({
  q: z.string().optional(), departmentId: z.uuid().optional(),
  status: z.enum(["probation", "active", "exited"]).optional(),
  page: z.coerce.number().min(1).default(1), pageSize: z.coerce.number().min(1).max(100).default(20),
});

/**
 * Lists employees in a paginated, filterable directory view.
 *
 * Employees always get exactly their own record, regardless of filters — this
 * is also the tool the AI assistant uses for `search_employees`.
 *
 * @param user The caller (role-scoping applied here).
 * @param f    Validated filters and pagination.
 * @returns `{ rows, total, page, pageSize }` — directory fields only, no salary.
 */
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

// ── Step 5: 360 view and self-service ─────────────────────────────────────────

/**
 * Full profile for one employee; salary included only for HR/Admin.
 *
 * @param user The caller.
 * @param id   Employee id.
 * @returns The employee row, plus `{ salary }` for HR/Admin.
 * @throws 403 when an employee requests someone else's profile; 404 if unknown.
 */
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

/**
 * Updates the caller's own contact details (phone, address).
 *
 * @param user  The signed-in employee.
 * @param input `{ phone?, address? }`.
 * @returns The updated employee row.
 * @throws 403 when the account has no employee profile.
 */
export async function updateOwnContact(user: SessionUser, input: { phone?: string; address?: string }) {
  if (!user.employeeId) throw forbidden();
  const [before] = await db.select().from(employees).where(eq(employees.id, user.employeeId));
  const [after] = await db.update(employees).set({ phone: input.phone, address: input.address })
    .where(eq(employees.id, user.employeeId)).returning();
  await audit(db, user, "employee.update_contact", "employee", user.employeeId, before, after);
  return after;
}

// ── Step 6: CSV import ────────────────────────────────────────────────────────

/** Validation for one CSV row (headers: code,email,firstName,lastName,department,joinDate,salary). */
const rowSchema = z.object({
  code: z.string().min(1, "required"),
  email: z.email("invalid email"),
  firstName: z.string().min(1, "required"),
  lastName: z.string().min(1, "required"),
  department: z.string().min(1, "required"),
  joinDate: z.iso.date("must be ISO date YYYY-MM-DD"),
  salary: z.coerce.number().positive("must be > 0"),
});

/**
 * Validates and imports employees from CSV.
 *
 * @param user   The HR user performing the import.
 * @param csv    Raw CSV text (header row required).
 * @param dryRun When `true`, only validates and reports problems.
 * @returns `{ dryRun, imported, valid, errors }` where `errors` are
 *          `{ row, field, reason }` with 1-based spreadsheet row numbers.
 * @throws 403 for non-HR.
 */
export async function importCsv(user: SessionUser, csv: string, dryRun: boolean) {
  if (user.role !== "HR" && user.role !== "ADMIN") throw forbidden();
  const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
  const depts = new Map((await db.select().from(departments)).map((d) => [d.name.toLowerCase(), d.id]));
  const existing = await db.select({ email: users.email }).from(users);
  const existingCodes = await db.select({ code: employees.code }).from(employees);
  const emails = new Set(existing.map((u) => u.email));
  const codes = new Set(existingCodes.map((c) => c.code));

  const errors: { row: number; field: string; reason: string }[] = [];
  const valid: (z.infer<typeof rowSchema> & { departmentId: string })[] = [];

  parsed.data.forEach((raw, i) => {
    const row = i + 2; // +1 for the header, +1 for 1-based spreadsheet numbering
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
    // Track seen values so two identical rows in the same file are caught too.
    if (ok) { emails.add(email); codes.add(d.code); valid.push({ ...d, departmentId: depts.get(d.department.toLowerCase())! }); }
  });

  // All-or-nothing: one bad row means nothing is written, so HR can fix the
  // file and re-upload without half an import sitting in the database.
  if (dryRun || errors.length) return { dryRun, imported: 0, valid: valid.length, errors };

  const created = await db.transaction(async (tx) => {
    let imported = 0;
    for (const r of valid) {
      const temp = tempPassword();
      const [u] = await tx.insert(users).values({
        email: r.email.toLowerCase(), passwordHash: await hashPassword(temp),
        role: "EMPLOYEE", mustChangePassword: true,
      }).returning();
      const [e] = await tx.insert(employees).values({
        code: r.code, userId: u.id, firstName: r.firstName, lastName: r.lastName,
        departmentId: r.departmentId, joinDate: r.joinDate, status: "active",
      }).returning();
      await tx.insert(salaryStructures).values({
        employeeId: e.id, basic: r.salary, effectiveFrom: r.joinDate, createdBy: user.id,
      });
      await notify(tx, u.id, "Welcome", "Your account is ready. Change your temporary password on first sign-in.");
      imported++;
    }
    await audit(tx, user, "employee.import", "employee", null, null, { imported });
    return imported;
  });

  return { dryRun: false, imported: created, valid: valid.length, errors };
}
