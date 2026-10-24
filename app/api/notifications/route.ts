/**
 * @fileoverview The signed-in user's notification list.
 *
 * @description
 * Returns the caller's most recent notifications (newest first). Rows are
 * written by `notify()` in `server/lib/audit.ts` — e.g. when an employee is
 * registered or a leave decision is made. There is no cross-user access: the
 * query is always filtered by the session's own `user.id`.
 *
 * @implementation
 *
 * Step 1: Authenticate for any role.
 * Step 2: Select notifications for the caller only.
 * Step 3: Order newest first and cap at 50 (the bell only shows recent items).
 * Step 4: Read-only; marking as read is a separate concern (`readAt` column).
 * Step 5: Used by the shell's notification list.
 * Step 6: A user must never see another user's notifications.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

import { eq, desc } from "drizzle-orm";
import { withAuth } from "@/server/auth/guard";
import { db } from "@/server/db";
import { notifications } from "@/server/db/schema";

// Session-guarded route: reads cookies() through withAuth, so it cannot be
// prerendered. Opt the segment out of instant-navigation validation.
export const instant = false;

/**
 * Lists the caller's latest 50 notifications.
 *
 * @returns Array of notification rows.
 */
export const GET = withAuth(["ADMIN", "HR", "EMPLOYEE"], async (_r, _c, user) =>
  Response.json(await db.select().from(notifications).where(eq(notifications.userId, user.id)).orderBy(desc(notifications.createdAt)).limit(50))
);
