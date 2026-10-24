/**
 * @fileoverview Conversational assistant endpoint (tool-calling chat).
 *
 * @description
 * `POST /api/ai/chat` takes the running conversation and answers using the
 * caller's role-scoped read-only tools. The model can look data up but can never
 * write: there is no write tool, and the toolset itself is built per role.
 *
 * Guards, in order: session + role (`withAuth`), hourly rate limit, body shape.
 * The model is capped at 4 tool steps and 15 s. Every call is logged to
 * `ai_logs` — including failures — because that table is also the rate-limit
 * ledger. Failures return a friendly degraded `answer` rather than an error, so
 * the panel keeps working when the provider is down.
 *
 * @implementation
 *
 * Step 1: Authenticate and rate-limit.
 * Step 2: Validate `{ messages: [{ role, content }] }` (1–20 turns, 2k chars each).
 * Step 3: Read "today" from company settings so relative dates resolve correctly.
 * Step 4: Call the model with the system prompt and tools.
 * Step 5: Log prompt, answer, tools used and latency; return `{ answer, label }`.
 * Step 6: On any failure, log the error and return `degraded: true`.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

// ── Steps 1–3: dependencies and validation ────────────────────────────────────
import { generateText, stepCountIs } from "ai";
import { z } from "zod";
import { withAuth } from "@/server/auth/guard";
import { model } from "@/server/ai/provider";
import { buildTools } from "@/server/ai/tools";
import { systemPrompt } from "@/server/ai/prompts";
import { enforceRateLimit, logAi } from "@/server/ai/limits";
import { getSettings } from "@/server/services/org.service";
import { nowIn } from "@/server/lib/dates";

const body = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(2000) })).min(1).max(20),
});

/** Vercel keeps the function alive long enough for a 15 s model call. */
export const maxDuration = 30;

/**
 * Answers one turn of the conversation.
 *
 * @param req JSON body `{ messages: [{ role, content }] }`.
 * @returns `{ answer, label: "AI-generated", degraded? }`.
 * @throws 401/403 via `withAuth`; 429 when over the hourly limit; 400 on bad input.
 */
export const POST = withAuth(["ADMIN", "HR", "EMPLOYEE"], async (req, _c, user) => {
  await enforceRateLimit(user.id);
  const { messages } = body.parse(await req.json());
  const last = messages[messages.length - 1].content;
  const { date } = nowIn((await getSettings()).timezone);
  const t0 = Date.now();

  // ── Steps 4–6: model call, logging, graceful degradation ──
  try {
    const res = await generateText({
      model: model(),
      system: systemPrompt(user, date),
      messages,
      tools: buildTools(user),
      stopWhen: stepCountIs(4),
      abortSignal: AbortSignal.timeout(15_000),
    });
    const toolsUsed = res.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName));
    await logAi({ userId: user.id, kind: "chat", prompt: last, response: res.text, toolsUsed, latencyMs: Date.now() - t0 });
    return Response.json({ answer: res.text, label: "AI-generated" });
  } catch (e) {
    await logAi({ userId: user.id, kind: "chat", prompt: last, latencyMs: Date.now() - t0, error: e instanceof Error ? e.message : String(e) });
    return Response.json({ answer: "The assistant is unavailable right now. Please try again shortly.", label: "AI-generated", degraded: true });
  }
});
