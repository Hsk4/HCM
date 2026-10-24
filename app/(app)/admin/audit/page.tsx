"use client";

/**
 * @fileoverview `/admin/audit` — append-only audit trail viewer.
 *
 * @description
 * Pages through `audit_logs`, newest first. Every sensitive mutation writes one
 * row in the same transaction as the change, so this view is the authoritative
 * record of who did what. Rows are immutable: there is no edit or delete.
 *
 * @implementation
 *
 * Step 1: Load page 1 (50 rows per page).
 * Step 2: Render action, entity, actor and timestamp.
 * Step 3: Expandable before/after JSON per row.
 * Step 4: Previous/Next pagination; disable at the ends.
 * Step 5: Filters are intentionally absent — the log is chronological.
 * Step 6: A login performed on the login page must appear here.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

import { Fragment, useState } from "react";
import { useJson } from "@/lib/use-json";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { PageHeader, StateRow } from "@/components/page-kit";

type Entry = {
  id: string;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
};

/** Colour-codes an action by its verb so destructive actions stand out. */
function toneFor(
  action: string,
): "success" | "warning" | "danger" | "info" | "neutral" {
  if (/delete|deactivate|reject|cancel/.test(action)) return "danger";
  if (/finalize|approve/.test(action)) return "success";
  if (/create|register|post|apply|login|import/.test(action)) return "info";
  if (/update|draft|change/.test(action)) return "warning";
  return "neutral";
}

/**
 * Renders the audit log.
 *
 * @returns The audit page content.
 */
export default function AdminAuditPage() {
  const [page, setPage] = useState(1);
  const { data, error, loading } = useJson<Entry[]>(`/api/audit?page=${page}`, [
    page,
  ]);
  const [expanded, setExpanded] = useState<string | null>(null);

  const rows = data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Audit log"
        subtitle="Every sensitive change, newest first. Read-only."
      />

      <Card>
        <CardBody className="p-0">
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Action</Th>
                <Th>Entity</Th>
                <Th>Actor</Th>
                <Th className="text-right">Detail</Th>
              </tr>
            </thead>
            <tbody>
              <StateRow
                loading={loading}
                error={error}
                empty={!loading && !error && rows.length === 0}
                colSpan={5}
              />
              {rows.map((e) => (
                <Fragment key={e.id}>
                  <tr>
                    <Td className="whitespace-nowrap font-mono text-xs">
                      {new Date(e.createdAt).toLocaleString()}
                    </Td>
                    <Td>
                      <Badge tone={toneFor(e.action)}>{e.action}</Badge>
                    </Td>
                    <Td className="text-xs">
                      {e.entity}
                      {e.entityId ? (
                        <span className="ml-1 font-mono text-zinc-400">
                          {e.entityId.slice(0, 8)}
                        </span>
                      ) : null}
                    </Td>
                    <Td className="text-xs">
                      {e.actorRole ?? "system"}
                      {e.actorId ? (
                        <span className="ml-1 font-mono text-zinc-400">
                          {e.actorId.slice(0, 8)}
                        </span>
                      ) : null}
                    </Td>
                    <Td className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setExpanded(expanded === e.id ? null : e.id)
                        }
                      >
                        {expanded === e.id ? "Hide" : "Show"}
                      </Button>
                    </Td>
                  </tr>
                  {expanded === e.id && (
                    <tr key={`${e.id}-detail`}>
                      <td
                        colSpan={5}
                        className="bg-zinc-50 px-3 py-2 dark:bg-zinc-900/60"
                      >
                        <div className="grid gap-2 text-xs sm:grid-cols-2">
                          <div>
                            <p className="mb-1 font-medium text-zinc-500">
                              Before
                            </p>
                            <pre className="max-h-48 overflow-auto rounded bg-white p-2 font-mono dark:bg-zinc-950">
                              {JSON.stringify(e.before, null, 2) ?? "null"}
                            </pre>
                          </div>
                          <div>
                            <p className="mb-1 font-medium text-zinc-500">
                              After
                            </p>
                            <pre className="max-h-48 overflow-auto rounded bg-white p-2 font-mono dark:bg-zinc-950">
                              {JSON.stringify(e.after, null, 2) ?? "null"}
                            </pre>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>

      <div className="flex items-center justify-between text-sm text-zinc-500">
        <span>Page {page}</span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={rows.length < 50}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
