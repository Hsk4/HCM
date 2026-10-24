import { generateText, Output } from "ai";
import { z } from "zod";
import { withAuth } from "@/server/auth/guard";
import { model } from "@/server/ai/provider";
import { dateTable } from "@/server/ai/prompts";
import { enforceRateLimit, logAi } from "@/server/ai/limits";
import { getSettings } from "@/server/services/org.service";
import { nowIn } from "@/server/lib/dates";
import * as leave from "@/server/services/leave.service";

/**
 * @fileoverview Natural-language leave request → structured draft.
 *
 * @description
 * Turns "I need next Monday and Tuesday off for my sister's wedding" into
 * `{ type, start, end, reason }`, then dry-runs the real leave rules so the form
 * can warn about balance/overlap. NOTHING is saved here: the confirm button
 * calls `POST /api/leave`, which validates again. Two attempts, then a graceful
 * fallback to the plain form (`fallback: true`).
 *
 * @see app/api/leave/route.ts — the write path
 * @see server/services/leave.service.ts — `validate`
 */

const LeaveDraft = z.object({
  type: z.enum(["annual", "sick", "casual", "unpaid"]),
  start: z.iso.date(),
  end: z.iso.date(),
  reason: z.string().max(200),
});

export const POST = withAuth(["EMPLOYEE"], async (req, _c, user) => {
  await enforceRateLimit(user.id);
  const { text } = z.object({ text: z.string().min(3).max(500) }).parse(await req.json());
  const { date } = nowIn((await getSettings()).timezone);
  const t0 = Date.now();

  let draft: z.infer<typeof LeaveDraft> | null = null;
  for (let attempt = 0; attempt < 2 && !draft; attempt++) {       
    try {
      // AI SDK v6: `generateObject` is deprecated in favour of
      // `generateText` with an `output` schema.
      const { output: object } = await generateText({
        model: model(), output: Output.object({ schema: LeaveDraft }),
        abortSignal: AbortSignal.timeout(15_000),
        system: `Convert the employee's request into a leave draft.
Today is ${date}. Use ONLY these calendar dates when resolving words like "next Monday":
${dateTable(date)}
Rules: weddings, family events, personal errands => casual. Illness => sick. Planned holiday/vacation => annual. If unclear use casual.
"next Monday" means the first Monday of the NEXT calendar week. Output only the fields.`,
        prompt: text,
      });
      if (object.end >= object.start) draft = object;
    } catch { /* retry */ }
  }
  await logAi({ userId: user.id, kind: "smart_leave", prompt: text, response: JSON.stringify(draft), latencyMs: Date.now() - t0, error: draft ? undefined : "parse_failed" });

  if (!draft) return Response.json({ draft: null, fallback: true, label: "AI-generated" }); 

  let warning: string | null = null;
  let days: number | null = null;
  try { ({ days } = await leave.validate(user.employeeId!, draft.type, draft.start, draft.end)); }
  catch (e) { warning = e instanceof Error ? e.message : String(e); }
  return Response.json({ draft, days, warning, label: "AI-generated" });
});