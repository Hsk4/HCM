import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { withAuth } from "@/server/auth/guard";
import { db } from "@/server/db";
import { announcements } from "@/server/db/schema";
import { audit } from "@/server/lib/audit";
import { badRequest, notFound } from "@/server/errors";

/**
 * @fileoverview Company announcements.
 *
 * @description
 * `GET` lists the latest 20 announcements for every signed-in role; `POST`
 * publishes one for ADMIN/HR only. The path is `/api/announcements`, matching
 * the `/admin/announcements` and `/hr/announcements` menu entries.
 *
 * @note The folder was originally misspelled (`app/api/annoucements/`), so the
 *       route only answered on the wrong URL and the UI got a 404. The spelling
 *       is now correct; a permanent redirect is intentionally not used because
 *       no client ever called the misspelled path.
 */

const body = z.object({
  title: z.string().min(2).max(160),
  body: z.string().min(2).max(5000),
});

/**
 * Lists the latest announcements.
 *
 * @returns The 20 most recent announcement rows.
 */
export const GET = withAuth(["ADMIN", "HR", "EMPLOYEE"], async () =>
  Response.json(
    await db.select().from(announcements).orderBy(desc(announcements.createdAt)).limit(20),
  ),
);

/**
 * Publishes an announcement.
 *
 * @param req JSON body `{ title, body }`.
 * @returns The created announcement (201).
 */
export const POST = withAuth(["ADMIN", "HR"], async (req, _c, user) => {
  const input = body.parse(await req.json());
  const [a] = await db
    .insert(announcements)
    .values({ ...input, postedBy: user.id })
    .returning();
  await audit(db, user, "announcement.post", "announcement", a.id, null, a);
  return Response.json(a, { status: 201 });
});

/**
 * Deletes an announcement.
 *
 * @param req Query `?id=`.
 * @returns `{ ok: true }`.
 * @throws 404 when the id does not exist (the delete affects no rows).
 */
export const DELETE = withAuth(["ADMIN", "HR"], async (req, _c, user) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw badRequest("Query parameter `id` is required");
  const [before] = await db.select().from(announcements).where(eq(announcements.id, id));
  if (!before) throw notFound("Announcement not found");
  await db.delete(announcements).where(eq(announcements.id, id));
  await audit(db, user, "announcement.delete", "announcement", id, before, null);
  return Response.json({ ok: true });
});
