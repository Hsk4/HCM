import { z } from "zod";
import { bootstrapFromEnv, needsSetup, runSetup } from "@/server/services/setup.service";
import { createSession } from "@/server/auth/session";
import { errorResponse } from "@/server/errors";

/**
 * @fileoverview First-run setup endpoint.
 *
 * @description
 * Creates the company, the first ADMIN login and the default leave types, then
 * signs the admin in. `GET` lets the UI decide whether to show `/setup`;
 * `POST` performs the setup and is idempotent, so a double submit is harmless.
 *
 * @see server/services/setup.service.ts
 */

/**
 * Reports whether the app still needs first-time setup.
 *
 * Also performs the hands-off env bootstrap first: when `.env.local` contains
 * `ADMIN_EMAIL` + `ADMIN_PASSWORD` and the database is empty, this call creates
 * the company, the admin and the default leave types. That is how the
 * `ADMIN_*` variables in `.env.example` take effect without a `/setup` page
 * (none exists yet). It is a no-op once setup has completed.
 *
 * @returns `{ needsSetup: boolean }` — `false` after a successful bootstrap.
 */
export async function GET() {
  try {
    await bootstrapFromEnv();
    return Response.json({ needsSetup: await needsSetup() });
  } catch (e) {
    return errorResponse(e);
  }
}

const body = z.object({
  companyName: z.string().min(2, "Company name is too short").max(120),
  adminEmail: z.email(),
  adminPassword: z.string().min(8, "Use at least 8 characters"),
});

/**
 * Runs first-time setup and, when it created the admin, starts a session.
 *
 * @param req JSON body `{ companyName, adminEmail, adminPassword }`.
 * @returns `{ ok: true, adminId, needsSetup: false }`; `adminId` is `null` if
 *          setup had already been completed.
 * @throws 400 via `errorResponse` on invalid input.
 */
export async function POST(req: Request) {
  try {
    const input = body.parse(await req.json());
    const { adminId, alreadySetUp } = await runSetup({
      companyName: input.companyName.trim(),
      adminEmail: input.adminEmail.toLowerCase(),
      adminPassword: input.adminPassword,
    });

    // Only sign in when this call actually created the admin account.
    if (adminId) await createSession(adminId);

    return Response.json({ ok: true, adminId, alreadySetUp, needsSetup: false });
  } catch (e) {
    return errorResponse(e);
  }
}
