/**
 * @fileoverview The one model factory used by every AI route.
 *
 * @description
 * `model()` is a thin, purpose-named wrapper over `server/ai.ts`. Keeping the
 * routes calling `model()` (rather than importing a provider package directly)
 * means the provider policy lives in exactly one place — previously this file
 * hard-wired a Gemini client with `AI_API_KEY`, which crashed at import when no
 * key was set and silently bypassed the Neon AI Gateway.
 *
 * @implementation
 *
 * Step 1: Delegate provider selection to `getModel()` in `server/ai.ts`.
 * Step 2: If nothing is configured, throw a clear 503 instead of letting the
 *         AI SDK fail with an opaque provider error.
 * Step 3: Callers pass the result straight to `generateText` / tool calling.
 * Step 4: Return type is the AI SDK's language model, inferred from `getModel`.
 * Step 5: Used by `api/ai/chat`, `api/ai/summary`, `api/ai/smart-leave`.
 * Step 6: With no gateway and no key, each route must return a friendly
 *         degraded response rather than a 500.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

import { getModel } from "../ai";
import { AppError } from "../errors";

/**
 * Resolves the language model for an AI route.
 *
 * @returns The configured AI SDK language model.
 * @throws {AppError} 503 `AI_NOT_CONFIGURED` when no provider is configured.
 * @see server/ai.ts — the gateway → Gemini fallback order
 */
export function model() {
  const m = getModel();
  if (!m) {
    throw new AppError(
      503,
      "AI_NOT_CONFIGURED",
      "The AI assistant is not configured (NEON_AI_GATEWAY_* or AI_API_KEY).",
    );
  }
  return m;
}
