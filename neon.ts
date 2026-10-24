/**
 * @fileoverview Neon project configuration (services + branch policy).
 *
 * @description
 * Describes the Neon resources this app needs. `neon deploy` reads this file,
 * provisions the declared services, and writes their connection details into
 * `.env.local` (or `.env` when present) as `DATABASE_URL`,
 * `DATABASE_URL_UNPOOLED` and `NEON_BRANCH`.
 *
 * Branch policy: the default branch (`production`) is permanent and uses project
 * defaults. Preview/ephemeral branches get a 7-day TTL so they self-clean after
 * a review. Run `neon checkout <name>` to create one.
 *
 * AI Gateway is intentionally not enabled: it requires a paid Neon plan
 * (Launch/Scale) and the current org is on Free, where the gateway cannot serve
 * model requests and `neon deploy` refuses to apply. The application is already
 * written to prefer the gateway the moment `NEON_AI_GATEWAY_*` is present — see
 * `server/ai.ts` — so enabling it later needs no code change:
 *
 *   1. upgrade the org,
 *   2. add `aiGateway: true` to the config below,
 *   3. run `neon deploy` again.
 *
 * @implementation
 *
 * Step 1: Declare which services the app uses (`auth: false`).
 * Step 2: Define the branch policy as a function of `isDefault` / `exists`.
 * Step 3: `neon init` links the project; `neon deploy` applies this config.
 * Step 4: Env vars land in `.env.local` and are never committed (`.gitignore`).
 * Step 5: `server/env.ts` validates them; `server/db/index.ts` uses the pooled URL.
 * Step 6: `neon config plan` shows the diff before applying.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  // Step 1: services. `auth: false` — this app has its own JWT sessions.
  auth: false,

  // Step 2: branch policy — per-branch tuning.
  branch: (branch) => {
    if (branch.isDefault) {
      // Default branch (production): no overrides, uses project defaults.
      return {};
    }
    if (!branch.exists) {
      // New non-default branches: auto-expire after a week.
      // Run `neon checkout <name>` to create a new branch with these settings.
      return { ttl: "7d" };
    }
    // Existing branch: no changes.
    return {};
  },
});
