import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { AppError } from "@/server/errors";
import { audit } from "@/server/lib/audit";
import { withAuth } from "@/server/auth/guard";

/**
 * @fileoverview Password change endpoint.
 *
 * @description
 * Lets any signed-in user replace their own password. It is the *only* route
 * reachable while `mustChangePassword` is set (`allowMustChange: true`) — every
 * other guarded route returns 403 until the temporary password is replaced.
 * Changing it clears the flag and audits the event.
 *
 * @implementation
 *
 * Step 1: Accept any role, including users mid-forced-change.
 * Step 2: Validate `{ current, next }`; `next` must be at least 8 characters.
 * Step 3: Verify `current` against the stored hash (400 `WRONG_PASSWORD`).
 * Step 4: Store the new hash and clear `mustChangePassword`.
 * Step 5: Audit `auth.change_password`.
 * Step 6: A wrong current password must change nothing.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

/**
 * Replaces the caller's password.
 *
 * @param req JSON body `{ current, next }`.
 * @returns `{ ok: true }`.
 * @throws 400 `WRONG_PASSWORD` when `current` is incorrect.
 */
export const POST = withAuth(["ADMIN", "HR", "EMPLOYEE"], async (req, _c, user) => {
  const { current, next } = z.object({ current: z.string(), next: z.string().min(8) }).parse(await req.json());
  const [u] = await db.select().from(users).where(eq(users.id, user.id));
  if (!(await verifyPassword(current, u.passwordHash))) throw new AppError(400, "WRONG_PASSWORD", "Current password is wrong");
  await db.update(users).set({ passwordHash: await hashPassword(next), mustChangePassword: false }).where(eq(users.id, user.id));
  await audit(db, user, "auth.change_password", "user", user.id);
  return Response.json({ ok: true });
}, { allowMustChange: true });