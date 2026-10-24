import { z } from "zod";
import { withAuth } from "@/server/auth/guard";
import * as leave from "@/server/services/leave.service";

/**
 * @fileoverview Leave endpoints for the signed-in employee.
 *
 * @description
 * `GET` returns the caller's balance (and their requests when `?scope=requests`).
 * `POST` creates a request. The AI "smart leave" flow only ever returns a
 * *draft*; the confirm button calls this POST, which re-validates everything
 * against the real rules — so the AI can never write leave by itself.
 *
 * @see server/services/leave.service.ts
 * @see app/api/ai/smart-leave/route.ts
 */

const createBody = z.object({
  type: z.string().min(1),
  start: z.iso.date(),
  end: z.iso.date(),
  reason: z.string().max(500).optional(),
});

/**
 * Returns the caller's leave balance, or their request history.
 *
 * @param req Optional `?scope=requests` to list only the employee's requests.
 * @returns `{ balance, types, requests }`, or `{ requests }` for that scope.
 * @throws 403 when the account has no employee profile.
 */
export const GET = withAuth(["EMPLOYEE"], async (req, _c, user) => {
  const scope = new URL(req.url).searchParams.get("scope");
  if (scope === "requests") {
    const requests = await leave.listOwn(user);
    return Response.json({ requests });
  }
  // Balance, available types and current requests in one round trip: the leave
  // page renders all three and would otherwise fire three requests.
  const [balance, types, requests] = await Promise.all([
    leave.getBalance(user, user.employeeId!),
    leave.listTypes(),
    leave.listOwn(user),
  ]);
  return Response.json({ balance, types, requests });
});

/**
 * Creates a leave request for the caller after running the real validation.
 *
 * @param req JSON body `{ type, start, end, reason? }`.
 * @returns `{ request }` with the persisted row (201).
 * @throws 422 when dates overlap, exceed the balance, or contain no working days.
 */
export const POST = withAuth(["EMPLOYEE"], async (req, _c, user) => {
  const input = createBody.parse(await req.json());
  const request = await leave.apply(user, input);
  return Response.json({ request }, { status: 201 });
});
