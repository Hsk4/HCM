import { z } from "zod";
import { withAuth } from "@/server/auth/guard";
import * as leave from "@/server/services/leave.service";
import { errorResponse } from "@/server/errors";

/**
 * @fileoverview Leave approval decision.
 *
 * @description
 * HR approves or rejects one pending request. The decision is transactional and
 * audited, and the request's status change is what `resolveDailyStatuses` reads
 * afterwards — so approving leave immediately affects the attendance board and
 * the next payroll draft.
 *
 * @implementation
 *
 * Step 1: Authenticate as HR.
 * Step 2: Read `id` from the params and `{ approve, comment }` from the body.
 * Step 3: Delegate to `leave.decide` (checks "still pending").
 * Step 4: A request that was already decided returns 422.
 * Step 5: Used by `/hr/leave`.
 * Step 6: Double-clicking approve must not produce two decisions.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

const body = z.object({
  approve: z.boolean(),
  comment: z.string().max(500).default(""),
});

/**
 * Decides a leave request.
 *
 * @param req  JSON body `{ approve, comment? }`.
 * @param ctx  Route params — `id`.
 * @returns `{ ok: true }`.
 * @throws 403 for non-HR; 422 when the request is no longer pending.
 */
export const POST = withAuth(["HR"], async (req, ctx, user) => {
  try {
    const { id } = await ctx.params;
    const input = body.parse(await req.json());
    await leave.decide(user, id, input.approve, input.comment);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
});
