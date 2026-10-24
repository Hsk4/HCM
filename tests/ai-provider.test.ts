import { describe, expect, it } from "vitest";

/**
 * @fileoverview Regression tests for the AI provider selection and safe-import.
 *
 * @description
 * Two failures this suite guards against:
 *
 *  1. `server/ai/provider.ts` used to construct a Gemini client at import time,
 *     which threw whenever `AI_API_KEY` was unset (the normal Neon Gateway
 *     setup). Importing the module must now be safe; only calling `model()`
 *     may fail, and it must fail as a clear 503, not a crash.
 *  2. The provider decision must be identical everywhere. `aiInfo()` and
 *     `getModel()` are asserted against the same env so `GET /api/ai` can never
 *     report a different source than `POST /api/ai` uses.
 *
 * These tests run with no AI env configured (see `vitest.config.mts`).
 */

describe("provider module", () => {
  it("imports without a configured provider", async () => {
    await expect(import("@/server/ai/provider")).resolves.toBeTypeOf("object");
  });

  it("reports source 'none' and a null model when nothing is configured", async () => {
    const { aiInfo, getModel } = await import("@/server/ai");
    expect(aiInfo().source).toBe("none");
    expect(getModel()).toBeNull();
  });

  it("throws a 503 AppError, not a crash, when asked for an unconfigured model", async () => {
    const { model } = await import("@/server/ai/provider");
    expect(() => model()).toThrow(/not configured/i);
    try {
      model();
    } catch (e) {
      expect(e).toMatchObject({ status: 503, code: "AI_NOT_CONFIGURED" });
    }
  });
});
