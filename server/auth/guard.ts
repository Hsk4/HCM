/**
 * @fileoverview Route and layout authorization helpers.
 *
 * @description
 * Two entry points, one session source:
 *
 *  - `withAuth(roles, handler)` wraps a Route Handler. It authenticates,
 *    enforces the role list, blocks users who must still change their password,
 *    and converts every thrown error into the standard JSON envelope.
 *  - `requireRole(roles)` is for Server Components/layouts: it redirects
 *    instead of returning a status, because a page cannot render "403".
 *
 * @implementation
 *
 * Step 1: Read the session with `getSessionUser`.
 * Step 2: Reject unauthenticated callers (401 to APIs, `/login` for pages).
 * Step 3: Force the password-change flow before anything else.
 * Step 4: Enforce the role allow-list (403 to APIs, redirect to the caller's
 *         own dashboard for pages).
 * Step 5: Hand `(req, ctx, user)` to the handler so it never re-reads the session.
 * Step 6: Route all errors through `errorResponse` for one consistent shape.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

// ── Steps 1–5: the API wrapper ────────────────────────────────────────────────
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { AppError, errorResponse } from "../errors";
import { getSessionUser, Role, SessionUser } from "./session";

/** Route params for dynamic segments, e.g. `[id]` → `{ id: string }`. */
type Ctx = { params: Promise<Record<string, string>> };
type Handler = (req: NextRequest, ctx: Ctx, user: SessionUser) => Promise<Response>;

/**
 * Wraps a Route Handler with authentication and role authorization.
 *
 * @param roles Allowed roles; the handler only runs for these.
 * @param handler The route logic, receiving the resolved `user`.
 * @param opts  `allowMustChange` permits access while a password change is pending.
 * @returns A Next.js route handler function.
 * @throws Never — errors are converted to responses.
 */
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

// ── Steps 2–4 for pages: redirects instead of status codes ────────────────────

/**
 * Guards a Server Component or layout, redirecting when the caller may not be here.
 *
 * @param roles Roles allowed to render this segment.
 * @returns The authenticated user.
 * @redirects `/login` when unauthenticated; `/change-password` when a change is
 *            pending; the caller's own dashboard when the role is wrong.
 */
export async function requireRole(roles: Role[]) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/change-password");
  if (!roles.includes(user.role)) redirect(`/${user.role.toLowerCase()}`);
  return user;
}
