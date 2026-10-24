import { sql } from "drizzle-orm";
import { db } from "@/server/db";

export async function GET() {
  const started = Date.now();
  try {
    const [row] = await db.execute<{
      db: string;
      version: string;
      tables: number;
    }>(sql`
      select current_database() as db,
             current_setting('server_version') as version,
             (select count(*)::int from information_schema.tables
               where table_schema = 'public') as tables
    `);
    return Response.json({
      ok: true,
      database: row.db,
      serverVersion: row.version,
      publicTables: row.tables,
      latencyMs: Date.now() - started,
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
