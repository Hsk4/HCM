/**
 * @fileoverview Central environment-variable validation.
 *
 * @description
 * Every server module imports `env` from here instead of reading
 * `process.env` directly, so a missing or malformed variable fails loudly at
 * startup rather than surfacing later as `undefined` in a query. The schema is
 * declared once, and `aiGatewayEnabled` exposes the one derived decision the
 * rest of the app needs.
 *
 * @implementation
 *
 * Step 1: Declare the schema
 *  - Required: `DATABASE_URL` (pooled), `JWT_SECRET` (≥ 32 chars).
 *  - Optional: unpooled URL, Gemini key, Neon AI Gateway triple, bootstrap admin.
 *
 * Step 2: Parse without throwing first
 *  - `safeParse` lets us inspect which keys failed.
 *
 * Step 3: Tolerate the build phase only
 *  - `next build` runs with no `.env.local` in CI. If the *only* problems are
 *    secrets, we substitute a placeholder so modules can be imported for type
 *    generation. Any other failure still throws — even during a build.
 *
 * Step 4: Expose derived flags
 *  - `aiGatewayEnabled` is true only when both gateway values are present.
 *
 * Step 5: Integration
 *  - Used by `db/index.ts`, `auth/session.ts`, `ai.ts`, `services/setup`.
 *
 * Step 6: Verification
 *  - `bun run build` must pass with no env file; `bun run start` must refuse to
 *    serve with an invalid `DATABASE_URL`.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

// ── Step 1: dependencies and schema ───────────────────────────────────────────
import { z } from "zod";

/** Keys that are only needed to serve requests, never to compile. */
const SECRET_KEYS = ["JWT_SECRET"] as const;

const schema = z.object({
  /** Pooled (-pooler) connection string — use for application traffic. */
  DATABASE_URL: z.url(),
  /** Direct connection string — required for migrations and session-level work. */
  DATABASE_URL_UNPOOLED: z.url().optional(),
  JWT_SECRET: z.string().min(32),
  /** Direct Gemini key; optional because the Neon AI Gateway can replace it. */
  AI_API_KEY: z.string().optional(),
  /**
   * Gemini model name used on the direct path. `gemini-2.5-flash` is retired for
   * new API keys (the API returns "no longer available to new users").
   * `gemini-3.8-flash` is listed as available but currently does not respond
   * within the app's 15 s timeout, so the default is the stable 3.5 Flash.
   */
  AI_MODEL: z.string().default("gemini-3.5-flash"),
  // Neon AI Gateway (injected by `neon deploy` when neon.ts declares aiGateway).
  NEON_AI_GATEWAY_TOKEN: z.string().optional(),
  NEON_AI_GATEWAY_BASE_URL: z.url().optional(),
  /** Catalog model id used on the gateway path (e.g. `gemini-3-flash`). */
  NEON_AI_GATEWAY_MODEL: z.string().default("gemini-3-flash"),
  /** Optional first-run bootstrap; otherwise the `/setup` page is used. */
  ADMIN_EMAIL: z.email().optional().or(z.literal("")),
  ADMIN_PASSWORD: z.string().optional(),
  COMPANY_NAME: z.string().optional(),
});

// ── Steps 2 and 3: parse, tolerating only build-time secret gaps ──────────────
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const missingSecrets = parsed.error.issues.every((i) =>
    SECRET_KEYS.includes(i.path[0] as (typeof SECRET_KEYS)[number]),
  );
  if (!(isBuildPhase && missingSecrets)) throw parsed.error;
}

/** Validated environment. Never read `process.env` for these keys elsewhere. */
export const env: z.infer<typeof schema> = parsed.success
  ? parsed.data
  : schema.parse({
      ...process.env,
      // Placeholder only satisfies typing during `next build`; never used at runtime.
      JWT_SECRET: "build-time-placeholder-build-time-placeholder",
    });

// ── Step 4: derived flags ─────────────────────────────────────────────────────

/**
 * Prefer the Neon AI Gateway when it is configured; otherwise fall back to a
 * direct provider key (e.g. a Gemini key in `AI_API_KEY`).
 */
export const aiGatewayEnabled = Boolean(
  env.NEON_AI_GATEWAY_TOKEN && env.NEON_AI_GATEWAY_BASE_URL,
);
