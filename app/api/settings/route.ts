import { z } from "zod";
import { eq } from "drizzle-orm";
import { withAuth } from "@/server/auth/guard";
import { db } from "@/server/db";
import { settings } from "@/server/db/schema";
import { getSettings } from "@/server/services/org.service";
import { audit } from "@/server/lib/audit";
import { errorResponse } from "@/server/errors";

/**
 * @fileoverview Company settings (singleton row).
 *
 * @description
 * Backs `/admin/settings`. Settings drive most business rules (office hours,
 * grace, half-day threshold, weekend days, geofence, timezone), so only ADMIN
 * may read or change them. `id` is always `1`; the row is created by first-run
 * setup, so `PATCH` never inserts.
 *
 * @implementation
 *
 * Step 1: `GET` returns the singleton (`409 SETUP_REQUIRED` before setup).
 * Step 2: `PATCH` validates only the fields provided (all optional).
 * Step 3: Business validation: office time `HH:MM`, weekend indexes 0–6,
 *         latitude/longitude pairs, positive radius.
 * Step 4: Writes `updatedAt` and audits before/after snapshots.
 * Step 5: Used by `/admin/settings`.
 * Step 6: Invalid values are 400/422; a successful save is visible on reload.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

const patchBody = z
  .object({
    companyName: z.string().min(2).max(120),
    officeStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM"),
    graceMinutes: z.number().int().min(0).max(120),
    halfDayMinutes: z.number().int().min(30).max(720),
    weekendDays: z.array(z.number().int().min(0).max(6)).max(7),
    officeLat: z.number().min(-90).max(90).nullable(),
    officeLng: z.number().min(-180).max(180).nullable(),
    officeRadiusM: z.number().int().min(10).max(10_000),
    timezone: z.string().min(1).max(64),
  })
  .partial();

/**
 * Returns the current company settings.
 *
 * @returns The settings row.
 * @throws 409 `SETUP_REQUIRED` when the company has not been created yet.
 */
export const GET = withAuth(["ADMIN"], async () => {
  try {
    return Response.json(await getSettings());
  } catch (e) {
    return errorResponse(e);
  }
});

/**
 * Updates company settings.
 *
 * @param req JSON body with any subset of the settings fields.
 * @returns The updated settings row.
 * @throws 400 on invalid input; 409 before setup.
 */
export const PATCH = withAuth(["ADMIN"], async (req, _c, user) => {
  try {
    const input = patchBody.parse(await req.json());
    const before = await getSettings();

    const [after] = await db
      .update(settings)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(settings.id, 1))
      .returning();
    await audit(db, user, "settings.update", "settings", "1", before, after);
    return Response.json(after);
  } catch (e) {
    return errorResponse(e);
  }
});
