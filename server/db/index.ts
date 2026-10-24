/**
 * @fileoverview Schema-driven Postgres access layer.
 *
 * @description
 * One pooled, lazily-created postgres.js client shared by the whole server
 * process, wrapped by Drizzle. Next.js can evaluate a module several times
 * (route handlers are separate bundles), so the client is cached on
 * `globalThis` in development to avoid exhausting Neon connections on every
 * hot reload. In production the module is evaluated once per server instance.
 *
 * Connection choice matters: `DATABASE_URL` points at Neon's **pooled**
 * (-pooler / PgBouncer) endpoint, which is what serverless-style runtimes need
 * because they open many short-lived connections. `prepare: false` disables
 * server-side statement caching, which PgBouncer in transaction mode does not
 * support. Migrations deliberately use the **unpooled** URL in
 * `drizzle.config.ts`.
 *
 * @implementation
 *
 * Step 1: Read `DATABASE_URL` from the validated `env` module.
 * Step 2: Reuse a cached client in development (hot reload safety).
 * Step 3: Build the Drizzle instance with the full table registry so
 *         `db.query.*` relational helpers work.
 * Step 4: Export the transaction type used by services that accept `tx`.
 * Step 5: Integrate with every service and route through this single export.
 * Step 6: Verify via `GET /api/db/health` and the Neon status card on `/`.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

// ── Step 1: dependencies ──────────────────────
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env";
import { schema } from "./schema";

// ── Step 2: one client per process (dev-safe) ─────────────────
const globalForDb = globalThis as unknown as { client?: ReturnType<typeof postgres> };
const client = globalForDb.client ?? postgres(env.DATABASE_URL, { max: 5, prepare: false });
if (process.env.NODE_ENV !== "production") globalForDb.client = client;

// ── Steps 3 and 4: the Drizzle instance and transaction type ──────────────────
export const db = drizzle(client, { schema });

/** The transaction handle services receive inside `db.transaction(async (tx) => …)`. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
