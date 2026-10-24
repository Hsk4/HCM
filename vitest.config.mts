import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * @fileoverview Vitest configuration.
 *
 * @description
 * The tests import app code through the `@/*` alias declared in `tsconfig.json`.
 * Vitest does not read `tsconfig.paths`, so the alias is registered here —
 * without it every test failed with "Cannot find package '@/server/...'".
 *
 * @see tsconfig.json — `compilerOptions.paths`
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    // Unit tests only: the services import the DB client, which needs env vars.
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Fake secrets so `server/env.ts` validation passes without a live branch.
    env: {
      DATABASE_URL: "postgres://test:test@localhost:5432/test?sslmode=disable",
      DATABASE_URL_UNPOOLED: "postgres://test:test@localhost:5432/test?sslmode=disable",
      JWT_SECRET: "test-only-jwt-secret-that-is-at-least-32-characters",
    },
  },
});
