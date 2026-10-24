import { z } from "zod";
import { withAuth } from "@/server/auth/guard";
import * as attendance from "@/server/services/attendance.service";
import { errorResponse } from "@/server/errors";

/**
 * @fileoverview Attendance correction decision endpoint (HR only).
 *
 * @description
 * Employees file a correction when they forgot to check in/out; HR approves or
 * rejects it here. Approving writes the corrected times onto that day's
 * attendance row (`applyCorrection` in the service).
 *
 * @see server/services/attendance.service.ts — `decideCorrection`
 */

const decision = z.object({
  approve: z.boolean(),
  comment: z.string().max(500).optional(),
});

/**
 * Approves or rejects one correction request.
 *
 * @param req JSON body `{ approve: boolean, comment?: string }`.
 * @param ctx Route params — `id` is the correction id.
 * @returns `{ ok: true }`.
 * @throws 422 when the request is not pending; 403 for non-HR users.
 */
export const POST = withAuth(["HR"], async (req, ctx, user) => {
  try {
    const { id } = await ctx.params;
    const { approve, comment } = decision.parse(await req.json());
    await attendance.decideCorrection(user, id, approve, comment);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
});
