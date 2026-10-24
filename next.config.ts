import type { NextConfig } from "next";

/**
 * @fileoverview Next.js build/runtime configuration.
 *
 * @description
 * Three settings shape the whole app:
 *
 *  - `cacheComponents: true` — component-level caching with `use cache` and a
 *    static shell + streaming. Two consequences the code must respect:
 *    (a) the Node runtime is mandatory, so **no** `export const runtime` may
 *    appear anywhere; (b) any read of `cookies()`/`headers()` must sit behind a
 *    `<Suspense>` boundary or `export const instant = false`.
 *  - `partialPrefetching: true` — required alongside Cache Components; without
 *    it Next logs a warning.
 *  - `serverExternalPackages` — `@react-pdf/renderer` is kept out of the bundler
 *    so its PDF rendering works when generating payslips.
 *
 * The Turbopack rule loads the Tailwind CSS loader for `*.css` explicitly.
 *
 * @implementation
 *
 * Step 1: Enable Cache Components + Partial Prefetching.
 * Step 2: Mark server-only packages as external.
 * Step 3: Register the CSS loader rule.
 * Step 4: Keep `runtime`/`dynamic` segment exports out of every route file.
 * Step 5: Consumed by `next build`, `next dev` and `next start`.
 * Step 6: `bun run build` must complete with every route listed.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

const nextConfig: NextConfig = {
  /* config options here */
  serverExternalPackages: ["@react-pdf/renderer"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
