/**
 * @fileoverview Sign-in endpoint.
 *
 * @description
 * Verifies credentials and issues the session cookie. The response tells the
 * client where to go next (`role` → their dashboard, `mustChangePassword` →
 * `/change-password`), so the login page contains no authorization logic.
 *
 * @implementation
 *
 * Step 1: Validate `{ email, password }`.
 * Step 2: Look the user up by lower-cased email.
 * Step 3: Reject unknown, inactive, or wrong-password attempts with one uniform
 *         401 — the message must not reveal which part failed.
 * Step 4: Create the session cookie and audit the login.
 * Step 5: Return the role and password-change flag for client-side routing.
 * Step 6: A deactivated user must not get a session even with a valid password.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

// ── Steps 1–2: dependencies and lookup ────────────────────────────────────────
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import type { SessionUser } from "@/server/auth/session";
import { verifyPassword } from "@/server/auth/password";
import { createSession } from "@/server/auth/session";
import { AppError, errorResponse } from "@/server/errors";
import { audit } from "@/server/lib/audit";

const schema = z.object({ email: z.email(), password: z.string().min(1) });

/**
 * Authenticates a user and starts their session.
 *
 * @param req JSON body `{ email, password }`.
 * @returns `{ role, mustChangePassword }`.
 * @throws 400 on bad input; 401 `INVALID_CREDENTIALS` on any failed check.
 */
export async function POST(req: Request) {
  try {
    const { email, password } = schema.parse(await req.json());
    const [u] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
    // One message for every failure mode: never disclose which one it was.
    if (!u || !u.isActive || !(await verifyPassword(password, u.passwordHash)))
      throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");

    // ── Steps 4–5: session + audit + routing hints ──
    await createSession(u.id);
    // Audit needs only the actor's id and role; the rest of the session is
    // resolved on the next request.
    const actor: Pick<SessionUser, "id" | "role"> = { id: u.id, role: u.role };
    await audit(db, actor as SessionUser, "auth.login", "user", u.id);
    return Response.json({ role: u.role, mustChangePassword: u.mustChangePassword });
  } catch (e) { return errorResponse(e); }
}
