/**
 * @fileoverview AI rate limiting and call logging.
 *
 * @description
 * `ai_logs` is both the audit trail and the rate-limit ledger: one row per AI
 * call, written even when the model fails. Counting rows from the last hour is
 * therefore the cheapest possible limiter — no Redis, no extra state, and the
 * limit survives deploys. 20 calls per user per hour is the documented cap.
 *
 * @implementation
 *
 * Step 1: `enforceRateLimit` counts the caller's rows in the last hour.
 * Step 2: At or above the cap, throw 429 `RATE_LIMITED` with a retry hint.
 * Step 3: `logAi` inserts the call record (prompt, response, tools, latency,
 *         error) — call it on both success and failure paths.
 * Step 4: A failed insert must not break the response, so callers log after
 *         they have their answer.
 * Step 5: Used by all three `/api/ai/*` routes before calling the model.
 * Step 6: The 21st call in an hour must be rejected, not merely slowed.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

// ── Steps 1–2: rate limit ─────────────────────────────────────────────────────
import { and, count, eq, gte } from "drizzle-orm";
import { db } from "../db";
import { aiLogs } from "../db/schema";
import { AppError } from "../errors";

/**
 * Rejects the caller when they have used up their hourly AI allowance.
 *
 * @param userId  The caller's user id.
 * @param perHour Maximum calls allowed in the trailing hour (default 20).
 * @returns Resolves when under the limit.
 * @throws {AppError} 429 `RATE_LIMITED` when the limit is reached.
 */
export async function enforceRateLimit(userId: string, perHour = 20) {
  const since = new Date(Date.now() - 3_600_000);
  const [{ n }] = await db.select({ n: count() }).from(aiLogs).where(and(eq(aiLogs.userId, userId), gte(aiLogs.createdAt, since)));
  if (n >= perHour) throw new AppError(429, "RATE_LIMITED", `AI limit reached (${perHour} per hour). Try again later.`);
}

// ── Step 3: logging ───────────────────────────────────────────────────────────

/**
 * Records one AI call in `ai_logs`.
 *
 * @param e `userId`, `kind` (`chat` | `summary` | `smart_leave`), `prompt`,
 *          optional `response`/`toolsUsed`, `latencyMs`, optional `error`.
 * @returns Resolves when the row is written.
 */
export async function logAi(e: { userId: string; kind: string; prompt: string; response?: string; toolsUsed?: string[]; latencyMs: number; error?: string }) {
  await db.insert(aiLogs).values(e);
}
