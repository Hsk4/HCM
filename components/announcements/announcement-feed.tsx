"use client";

/**
 * @fileoverview Company announcements feed.
 *
 * @description
 * Serves `/admin/announcements`, `/hr/announcements` and
 * `/employee/announcements`. Everyone signed in can read; posting and deleting
 * are limited to ADMIN/HR both here (controls hidden) and in the API (enforced).
 *
 * @implementation
 *
 * Step 1: Load the latest 20 announcements.
 * Step 2: Render newest-first as cards with relative timestamps.
 * Step 3: When `canPost`, show a form to publish a new announcement.
 * Step 4: Delete asks for confirmation and reloads.
 * Step 5: Empty state explains that nothing has been posted yet.
 * Step 6: Employees never see post/delete controls.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

import { useState } from "react";
import { api } from "@/lib/api";
import { useJson } from "@/lib/use-json";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { ConfirmButton } from "@/components/modal";
import { ErrorNote, PageHeader, SuccessNote } from "@/components/page-kit";

type Announcement = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
};

/**
 * Formats an ISO timestamp as a short relative time.
 *
 * @param iso ISO timestamp.
 * @returns e.g. "3h ago".
 */
function ago(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Renders the announcement feed.
 *
 * @param props.canPost Whether to show publishing controls (ADMIN/HR).
 * @returns The announcements page content.
 */
export function AnnouncementFeed({ canPost }: { canPost: boolean }) {
  const { data, error, loading, reload } =
    useJson<Announcement[]>("/api/announcements");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function publish(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      await api("/api/announcements", {
        method: "POST",
        body: JSON.stringify({ title, body }),
      });
      setTitle("");
      setBody("");
      setNotice("Announcement published.");
      reload();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Could not publish");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await api(`/api/announcements?id=${id}`, { method: "DELETE" });
    setNotice("Announcement deleted.");
    reload();
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Announcements"
        subtitle={
          canPost
            ? "Company-wide messages visible to everyone."
            : "Company-wide messages."
        }
      />

      <SuccessNote message={notice} />
      <ErrorNote message={problem} />

      {canPost && (
        <Card>
          <CardHeader>
            <CardTitle>New announcement</CardTitle>
          </CardHeader>
          <CardBody>
            <form onSubmit={publish} className="flex flex-col gap-3">
              <Field label="Title" htmlFor="title">
                <Input
                  id="title"
                  required
                  minLength={2}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </Field>
              <Field label="Message" htmlFor="body">
                <Textarea
                  id="body"
                  required
                  minLength={2}
                  rows={3}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
              </Field>
              <div>
                <Button size="sm" type="submit" disabled={busy}>
                  {busy ? "Publishing…" : "Publish"}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      {loading && (
        <p className="text-sm text-zinc-500">Loading announcements…</p>
      )}
      {!loading && error && <ErrorNote message={error} />}
      {!loading && !error && (data?.length ?? 0) === 0 && (
        <p className="text-sm text-zinc-500">No announcements yet.</p>
      )}

      <div className="flex flex-col gap-3">
        {data?.map((a) => (
          <Card key={a.id}>
            <CardHeader>
              <div>
                <CardTitle>{a.title}</CardTitle>
                <p className="text-[11px] text-zinc-500">{ago(a.createdAt)}</p>
              </div>
              {canPost && (
                <ConfirmButton
                  label="Delete"
                  message="This removes the announcement for everyone."
                  onConfirm={() => remove(a.id)}
                  onDone={() => setNotice("Announcement deleted.")}
                />
              )}
            </CardHeader>
            <CardBody>
              <p className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
                {a.body}
              </p>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
