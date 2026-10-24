/**
 * @fileoverview Stateless session management (signed JWT cookie).
 *
 * @description
 * A signed HS256 JWT holds only the user id; everything else is re-read from
 * the database on each request. That means deactivating a user (`isActive`) or
 * forcing a password change takes effect immediately, without waiting for the
 * token to expire. The cookie is `httpOnly` (not readable by JS), `sameSite=lax`
 * (blocks cross-site POSTs) and `secure` in production.
 *
 * @implementation
 *
 * Step 1: Keep the role type and the `SessionUser` shape in one place — the
 *         whole app (guards, services, UI shell) depends on it.
 * Step 2: `createSession` signs `{ sub: userId }` for 8 hours and sets the cookie.
 * Step 3: `destroySession` deletes the cookie.
 * Step 4: `getSessionUser` verifies the token, then joins `employees` so the
 *         session carries `employeeId`; any failure yields `null`, never a throw.
 * Step 5: Used by `guard.ts`, `auth/*` routes and `lib/audit.ts`.
 * Step 6: An expired/edited token must resolve to `null`; a deactivated user
 *         must not resolve even with a valid token.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

// ── Steps 1–2: types and signing ──────────────────────────────────────────────
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users, employees } from "../db/schema";
import { env } from "../env";

/** The three roles the app distinguishes. */
export type Role = "ADMIN" | "HR" | "EMPLOYEE";

/** The authenticated caller, as seen by guards, services and the UI shell. */
export type SessionUser = {
  id: string;
  email: string;
  role: Role;
  /** Employee row id, or `null` for accounts without a profile (e.g. admin). */
  employeeId: string | null;
  mustChangePassword: boolean;
};

const COOKIE = "hcm_session";
const key = new TextEncoder().encode(env.JWT_SECRET);

/**
 * Issues a session token and stores it in the `httpOnly` cookie.
 *
 * @param userId The user's primary key.
 * @returns Resolves once the cookie is set.
 */
export async function createSession(userId: string) {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt().setExpirationTime("8h").sign(key);
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    path: "/", maxAge: 60 * 60 * 8,
  });
}

/** Clears the session cookie (no-op if absent). */
export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

// ── Steps 3–4: verification ───────────────────────────────────────────────────

/**
 * Resolves the current caller from the session cookie.
 *
 * @returns The user, or `null` when unauthenticated, expired, deactivated, or
 *          when the token cannot be verified.
 */
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
    // Bad signature, expired token, or malformed payload — all mean "no session".
    return null;
  }
}
