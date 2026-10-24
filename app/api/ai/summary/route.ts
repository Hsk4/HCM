import { generateText } from "ai";
import { withAuth } from "@/server/auth/guard";
import { model } from "@/server/ai/provider";
import { enforceRateLimit, logAi } from "@/server/ai/limits";
import * as analytics from "@/server/services/analytics.service";
import { z } from "zod";

/**
 * @fileoverview AI-written insight bullets for the HR/Admin dashboard.
 *
 * @description
 * Feeds the same KPI JSON used by `/api/dashboard/hr` to the model and asks for
 * 3–5 short bullets. The prompt forbids inventing numbers, so the text is only
 * a narrative over real figures. Returns `summary: null` + `degraded: true`
 * when the model is unavailable, letting the dashboard hide the card.
 *
 * @see app/api/dashboard/hr/route.ts
 */

const filtersSchema = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional(), departmentId: z.uuid().optional() });

export const POST = withAuth(["ADMIN", "HR"], async (req, _c, user) => {
  await enforceRateLimit(user.id);
  const f = filtersSchema.parse(await req.json());
  const kpis = await analytics.hrKpis(user, f);              
  const t0 = Date.now();
  try {
    const { text } = await generateText({
      model: model(),
      abortSignal: AbortSignal.timeout(15_000),
      system: "You write 3 to 5 short insight bullets for an HR dashboard. Use ONLY numbers present in the JSON. Do not invent figures. If data is sparse, say so.",
      prompt: JSON.stringify(kpis),
    });
    await logAi({ userId: user.id, kind: "summary", prompt: JSON.stringify(f), response: text, latencyMs: Date.now() - t0 });
    return Response.json({ summary: text, label: "AI-generated" });
  } catch (e) {
    await logAi({ userId: user.id, kind: "summary", prompt: JSON.stringify(f), latencyMs: Date.now() - t0, error: e instanceof Error ? e.message : String(e) });
    return Response.json({ summary: null, label: "AI-generated", degraded: true });
  }
});