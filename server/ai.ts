/**
 * @fileoverview AI provider selection: Neon AI Gateway or a direct Gemini key.
 *
 * @description
 * The app can talk to a model two ways, and every AI route must agree on which
 * one is active:
 *
 *  1. **Neon AI Gateway** (`@neon/ai-sdk-provider`) — reads
 *     `NEON_AI_GATEWAY_BASE_URL` and `NEON_AI_GATEWAY_TOKEN`, which
 *     `neon deploy` writes to `.env.local`. One token, many catalog models, and
 *     the browser never sees a provider key. Preferred when configured.
 *  2. **Direct Gemini key** (`AI_API_KEY`) — fallback for local development or
 *     when the gateway is unavailable (it requires a paid Neon plan).
 *
 * This module is the single place that decides. `aiInfo()` reports the decision
 * without building a client (safe for health checks); `getModel()` builds the
 * model for a request. Both clients are created lazily so importing this module
 * during `next build` never throws on missing credentials.
 *
 * Model ids differ by path: gateway ids are catalog ids (`gemini-3-flash`,
 * `claude-haiku-4-5`, `gpt-5-mini`), direct-path ids are Gemini model names
 * (`gemini-2.5-flash`).
 *
 * @implementation
 *
 * Step 1: Import the two provider SDKs and the validated env.
 * Step 2: Create the Gemini client lazily, only when a key exists.
 * Step 3: `aiInfo` — pure selection of source + model id for diagnostics.
 * Step 4: `getModel` — build the model, or `null` when unconfigured.
 * Step 5: `ai/provider.ts` wraps `getModel()` and turns `null` into a 503.
 * Step 6: `GET /api/ai` must report the same source that `POST /api/ai` uses.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

// ── Steps 1–2: dependencies and lazy clients ──────────────────────────────────
import { neon } from "@neon/ai-sdk-provider";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { aiGatewayEnabled, env } from "./env";

/** Which provider is in effect. `"none"` means nothing is configured. */
export type ModelSource = "neon-ai-gateway" | "google";

/**
 * Built lazily: `env.AI_API_KEY` may be absent, and the client must not be
 * constructed at module load (which happens during `next build`).
 */
let googleClient: ReturnType<typeof createGoogleGenerativeAI> | null = null;
function google() {
  if (!env.AI_API_KEY) return null;
  googleClient ??= createGoogleGenerativeAI({ apiKey: env.AI_API_KEY });
  return googleClient;
}

// ── Step 3: diagnostics ───────────────────────────────────────────────────────

/**
 * Reports which provider/model is currently in effect, without building one.
 *
 * @returns `{ source, model }` — `source` is `"none"` when nothing is configured.
 */
export function aiInfo(): { source: ModelSource | "none"; model: string } {
  if (aiGatewayEnabled) return { source: "neon-ai-gateway", model: env.NEON_AI_GATEWAY_MODEL };
  if (env.AI_API_KEY) return { source: "google", model: env.AI_MODEL };
  return { source: "none", model: env.AI_MODEL };
}

// ── Step 4: model factory ─────────────────────────────────────────────────────

/**
 * Returns an AI SDK language model for `generateText` / tool calling.
 *
 * @returns The model, or `null` when no provider is configured.
 * @see server/ai/provider.ts — the throwing wrapper used by routes
 */
export function getModel() {
  if (aiGatewayEnabled) return neon(env.NEON_AI_GATEWAY_MODEL);
  const g = google();
  return g ? g(env.AI_MODEL) : null;
}
