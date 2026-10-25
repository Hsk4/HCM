import { z } from "zod";
import { asc, count, desc, eq } from "drizzle-orm";
import { withAuth } from "@/server/auth/guard";
import { db } from "@/server/db";
import {
  departments,
  designations,
  leaveTypes,
  holidays,
  employees,
} from "@/server/db/schema";
import { audit } from "@/server/lib/audit";
import { conflict, badRequest, errorResponse } from "@/server/errors";

/**
 * @fileoverview Organisation reference data: departments, designations, leave
 * types and public holidays.
 *
 * @description
 * These four small tables define the vocabulary the rest of the app uses:
 * departments group employees and drive filters, leave types carry the yearly
 * quotas that balance validation relies on, and holidays are excluded from
 * working-day counts (attendance, leave, payroll). They are ADMIN-managed and
 * HR-readable.
 *
 * One route file handles all four collections because they share the same CRUD
 * shape, distinguished by the `?type=` parameter:
 *   `department` | `designation` | `leaveType` | `holiday`
 *
 * @implementation
 *
 * Step 1: Map `?type=` to its table and zod schema.
 * Step 2: `GET` lists (active-only when `?active=1`).
 * Step 3: `POST` inserts; duplicate names/codes are reported as 409.
 * Step 4: `PATCH` updates by `?id=`; `DELETE` deactivates or removes.
 * Step 5: Departments cannot be deleted while employees reference them.
 * Step 6: Every write is audited with before/after snapshots.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

const TYPES = {
  department: z.object({
    name: z.string().min(2).max(80),
    isActive: z.boolean().optional(),
  }),
  designation: z.object({ name: z.string().min(2).max(80) }),
  leaveType: z.object({
    code: z
      .string()
      .min(2)
      .max(24)
      .regex(/^[a-z_]+$/, "lowercase letters and underscores"),
    name: z.string().min(2).max(60),
    yearlyQuota: z.number().int().min(0).max(365).nullable(),
    isPaid: z.boolean(),
  }),
  holiday: z.object({ date: z.iso.date(), name: z.string().min(2).max(120) }),
} as const;

type Kind = keyof typeof TYPES;

/**
 * Validates the `type` query parameter.
 *
 * @param raw Query value.
 * @returns The collection name.
 * @throws 400 when the value is missing or unknown.
 */
function kindOf(raw: string | null): Kind {
  if (!raw || !(raw in TYPES)) {
    throw badRequest(
      "Query parameter `type` must be one of: " + Object.keys(TYPES).join(", "),
    );
  }
  return raw as Kind;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- heterogeneous tables share one handler */
const TABLES: Record<Kind, any> = {
  department: departments,
  designation: designations,
  leaveType: leaveTypes,
  holiday: holidays,
};
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Lists reference data of one kind.
 *
 * @param req Query: `type` (required), `active=1` to filter inactive departments.
 * @returns Array of rows.
 */
export const GET = withAuth(["ADMIN", "HR"], async (req) => {
  try {
    const url = new URL(req.url);
    const kind = kindOf(url.searchParams.get("type"));
    const table = TABLES[kind];

    let q = db.select().from(table);
    if (kind === "department" && url.searchParams.get("active") === "1") {
      q = q.where(eq(departments.isActive, true)) as typeof q;
    }
    const order = kind === "holiday" ? desc(holidays.date) : asc(table.name);
    return Response.json(await q.orderBy(order));
  } catch (e) {
    return errorResponse(e);
  }
});

/**
 * Creates a reference-data row.
 *
 * @param req Query `type`; JSON body per collection.
 * @returns The created row (201).
 * @throws 409 when a unique name/code/date already exists.
 */
export const POST = withAuth(["ADMIN"], async (req, _c, user) => {
  try {
    const kind = kindOf(new URL(req.url).searchParams.get("type"));
    const input = TYPES[kind].parse(await req.json());
    const table = TABLES[kind];
    const [row] = await db
      .insert(table)
      .values(input as never)
      .returning();
    await audit(db, user, `${kind}.create`, kind, row.id, null, row);
    return Response.json(row, { status: 201 });
  } catch (e) {
    if (isUniqueViolation(e))
      return errorResponse(conflict("That name, code or date already exists"));
    return errorResponse(e);
  }
});

/**
 * Updates a reference-data row.
 *
 * @param req Query `type` and `id`; JSON body with the fields to change.
 * @returns The updated row.
 */
export const PATCH = withAuth(["ADMIN"], async (req, _c, user) => {
  try {
    const url = new URL(req.url);
    const kind = kindOf(url.searchParams.get("type"));
    const id = url.searchParams.get("id");
    if (!id) throw badRequest("Query parameter `id` is required");
    const input = TYPES[kind].partial().parse(await req.json());

    const table = TABLES[kind];
    const [before] = await db.select().from(table).where(eq(table.id, id));
    const [after] = await db
      .update(table)
      .set(input as never)
      .where(eq(table.id, id))
      .returning();
    if (!after) throw badRequest("Row not found");
    await audit(db, user, `${kind}.update`, kind, id, before, after);
    return Response.json(after);
  } catch (e) {
    if (isUniqueViolation(e))
      return errorResponse(conflict("That name, code or date already exists"));
    return errorResponse(e);
  }
});

/**
 * Removes a reference-data row.
 *
 * Departments are deactivated rather than deleted when employees still
 * reference them, because the foreign key would otherwise fail.
 *
 * @param req Query `type` and `id`.
 * @returns `{ ok: true, deactivated?: boolean }`.
 */
export const DELETE = withAuth(["ADMIN"], async (req, _c, user) => {
  try {
    const url = new URL(req.url);
    const kind = kindOf(url.searchParams.get("type"));
    const id = url.searchParams.get("id");
    if (!id) throw badRequest("Query parameter `id` is required");

    if (kind === "department") {
      const [{ n }] = await db
        .select({ n: count() })
        .from(employees)
        .where(eq(employees.departmentId, id));
      if (n > 0) {
        await db
          .update(departments)
          .set({ isActive: false })
          .where(eq(departments.id, id));
        await audit(db, user, "department.deactivate", "department", id);
        return Response.json({ ok: true, deactivated: true });
      }
    }

    const table = TABLES[kind];
    const [before] = await db.select().from(table).where(eq(table.id, id));
    await db.delete(table).where(eq(table.id, id));
    await audit(db, user, `${kind}.delete`, kind, id, before, null);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
});

/**
 * Detects a Postgres unique-constraint violation.
 *
 * @param e Any thrown value.
 * @returns `true` for SQLSTATE 23505.
 */
function isUniqueViolation(e: unknown) {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: string }).code === "23505"
  );
}
