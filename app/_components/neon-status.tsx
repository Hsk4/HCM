import { Suspense } from "react";
import { sql } from "drizzle-orm";
import { db } from "@/server/db";

async function LiveDbStatus() {
  const rows = await db.execute<{ db: string; version: string; tables: number; ms: string }>(sql`
    select current_database() as db,
           current_setting('server_version') as version,
           (select count(*)::int from information_schema.tables
             where table_schema = 'public') as tables,
           round(extract(epoch from statement_timestamp() - now())::numeric * 1000)::text as ms
  `);
  const [row] = rows;

  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm text-zinc-600 dark:text-zinc-400">
      <dt>database</dt>
      <dd className="text-zinc-950 dark:text-zinc-50">{row.db}</dd>
      <dt>postgres</dt>
      <dd className="text-zinc-950 dark:text-zinc-50">{row.version}</dd>
      <dt>public tables</dt>
      <dd className="text-zinc-950 dark:text-zinc-50">{row.tables}</dd>
      <dt>round trip</dt>
      <dd className="text-zinc-950 dark:text-zinc-50">{row.ms} ms</dd>
    </dl>
  );
}

/**
 * Server-rendered Neon status. With `cacheComponents` on there is no
 * `force-dynamic`; dynamic data is streamed into the static shell, so the
 * uncached query lives behind its own Suspense boundary.
 */
export default function NeonStatus() {
  return (
    <Suspense fallback={<p className="font-mono text-sm text-zinc-500">connecting…</p>}>
      <LiveDbStatus />
    </Suspense>
  );
}
