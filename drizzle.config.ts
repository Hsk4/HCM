/**
 * @fileoverview Drizzle Kit configuration (migrations).
 *
 * @description
 * Points Drizzle Kit at the schema as its single source of truth and at the
 * **unpooled** Neon connection. That second point is not a detail: migrations
 * are session-level DDL, and PgBouncer's transaction pooling (the `-pooler`
 * host) rejects several statements Drizzle Kit needs, so applying a migration
 * through `DATABASE_URL` fails or hangs. `neon deploy` writes
 * `DATABASE_URL_UNPOOLED` into `.env.local` for exactly this purpose.
 *
 * Next.js loads `.env.local` automatically; `drizzle-kit` does not, which is why
 * the file is loaded explicitly below.
 *
 * @implementation
 *
 * Step 1: Load `.env.local` if present (skip quietly in CI).
 * Step 2: Point `schema` at `server/db/schema.ts` — never duplicate table defs.
 * Step 3: Write generated SQL to `./drizzle`.
 * Step 4: Use `dialect: "postgresql"`.
 * Step 5: Use the unpooled URL, falling back to the pooled one.
 * Step 6: `bunx drizzle-kit generate` then `bunx drizzle-kit migrate`.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

// ── Step 1: load local env ────────────────────────────────────────────────────
import { defineConfig } from "drizzle-kit";
import { loadEnvFile } from "node:process";

try {
  loadEnvFile(".env.local");
} catch {
  // No .env.local (e.g. in CI) — rely on the process environment instead.
}

// ── Steps 2–5: schema, output and connection ──────────────────────────────────
export default defineConfig({
  schema: "./server/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // Direct (unpooled) connection: PgBouncer transaction pooling breaks
  // migrations. `neon deploy` writes DATABASE_URL_UNPOOLED to .env.local.
  dbCredentials: { url: (process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL)! },
});
