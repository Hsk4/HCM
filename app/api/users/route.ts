import { z } from "zod";
import { and, count, desc, eq } from "drizzle-orm";
import { withAuth } from "@/server/auth/guard";
import { db } from "@/server/db";
import { users, employees } from "@/server/db/schema";
import { hashPassword, tempPassword } from "@/server/auth/password";
import { audit } from "@/server/lib/audit";
import {
  badRequest,
  conflict,
  unprocessable,
  errorResponse,
} from "@/server/errors";

/**
 * @fileoverview Login (user account) administration.
 *
 * @description
 * Backs `/admin/users`. A `users` row is the credential half of a person; the
 * `employees` row (when present) is the profile half. This route creates and
 * edits logins, can force a password change, and deactivates accounts — it
 * never deletes, so audit history keeps a valid actor reference.
 *
 * @implementation
 *
 * Step 1: `GET` lists logins with their employee code/name and status.
 * Step 2: `POST` creates a login with a generated temporary password.
 * Step 3: `PATCH ?id=` updates role / status / forced password reset.
 * Step 4: The last active ADMIN cannot be demoted or deactivated.
 * Step 5: Passwords are only ever hashed; the temporary one is returned once.
 * Step 6: Every change is audited (never including the password).
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

const createBody = z.object({
  email: z.email(),
  role: z.enum(["ADMIN", "HR", "EMPLOYEE"]),
});

const patchBody = z
  .object({
    role: z.enum(["ADMIN", "HR", "EMPLOYEE"]),
    isActive: z.boolean(),
    mustChangePassword: z.boolean(),
  })
  .partial();

/**
 * Lists logins.
 *
 * @returns Array of `{ id, email, role, isActive, mustChangePassword, employeeCode, name }`.
 */
export const GET = withAuth(["ADMIN"], async () => {
  try {
    return Response.json(
      await db
        .select({
          id: users.id,
          email: users.email,
          role: users.role,
          isActive: users.isActive,
          mustChangePassword: users.mustChangePassword,
          createdAt: users.createdAt,
          employeeCode: employees.code,
          firstName: employees.firstName,
          lastName: employees.lastName,
        })
        .from(users)
        .leftJoin(employees, eq(employees.userId, users.id))
        .orderBy(desc(users.createdAt)),
    );
  } catch (e) {
    return errorResponse(e);
  }
});

/**
 * Creates a login and returns its one-time temporary password.
 *
 * @param req JSON body `{ email, role }`.
 * @returns `{ user, temporaryPassword }` (201).
 * @throws 409 when the email is already registered.
 */
export const POST = withAuth(["ADMIN"], async (req, _c, user) => {
  try {
    const input = createBody.parse(await req.json());
    const email = input.email.toLowerCase();
    const dup = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));
    if (dup.length) throw conflict("That email already has a login");

    const temp = tempPassword();
    const [created] = await db
      .insert(users)
      .values({
        email,
        role: input.role,
        passwordHash: await hashPassword(temp),
        mustChangePassword: true,
      })
      .returning({ id: users.id, email: users.email, role: users.role });
    await audit(db, user, "user.create", "user", created.id, null, created);
    return Response.json(
      { user: created, temporaryPassword: temp },
      { status: 201 },
    );
  } catch (e) {
    return errorResponse(e);
  }
});

/**
 * Updates a login's role or status, or forces a password change.
 *
 * @param req Query `?id=`; body with any of `role`, `isActive`, `mustChangePassword`.
 * @returns `{ ok: true }`.
 * @throws 422 when the change would leave the company without an active admin.
 */
export const PATCH = withAuth(["ADMIN"], async (req, _c, user) => {
  try {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) throw badRequest("Query parameter `id` is required");
    const input = patchBody.parse(await req.json());

    const [before] = await db.select().from(users).where(eq(users.id, id));
    if (!before) throw badRequest("Login not found");

    // Keeping at least one active admin is a hard requirement: without it
    // nobody could finalize payroll or manage logins.
    const losesAdmin = input.role !== undefined && input.role !== "ADMIN";
    const deactivating = input.isActive === false;
    if (before.role === "ADMIN" && (losesAdmin || deactivating)) {
      // Counts the *other* active admins; this one is about to stop being one.
      const [{ n }] = await db
        .select({ n: count() })
        .from(users)
        .where(and(eq(users.role, "ADMIN"), eq(users.isActive, true)));
      if (n <= 1) throw unprocessable("At least one active admin is required");
    }

    const patch: Record<string, unknown> = { ...input };
    const [after] = await db
      .update(users)
      .set(patch)
      .where(eq(users.id, id))
      .returning();
    await audit(
      db,
      user,
      "user.update",
      "user",
      id,
      { role: before.role, isActive: before.isActive },
      {
        role: after.role,
        isActive: after.isActive,
        mustChangePassword: after.mustChangePassword,
      },
    );
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
});
