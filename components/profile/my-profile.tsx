"use client";

/**
 * @fileoverview `/employee/profile` — own details and contact editing.
 *
 * @description
 * Shows the employee's own record read-only (code, department, dates, status)
 * and lets them update their phone and address. Everything else is HR-managed,
 * so there are no editable fields for it — the API strips unknown keys anyway,
 * which prevents a crafted request from editing department or salary.
 *
 * @implementation
 *
 * Step 1: Load `/api/profile`.
 * Step 2: Render identity/employment as read-only rows.
 * Step 3: Phone and address are editable and saved via `PATCH`.
 * Step 4: Show the server's error, or a success note.
 * Step 5: Reload the form with the saved values after a successful save.
 * Step 6: An account without an employee profile shows the 403 explanation.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

import { useState } from "react";
import { api } from "@/lib/api";
import { useJson } from "@/lib/use-json";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { ErrorNote, PageHeader, SuccessNote } from "@/components/page-kit";

type Profile = {
  id: string;
  code: string;
  firstName: string;
  lastName: string;
  gender: string | null;
  phone: string | null;
  address: string | null;
  joinDate: string;
  exitDate: string | null;
  status: "probation" | "active" | "exited";
};

/**
 * Renders the profile page.
 *
 * @returns The profile page content.
 */
export function MyProfile() {
  const { data, error, loading, reload } = useJson<Profile>("/api/profile");

  if (loading) return <p className="text-sm text-zinc-500">Loading profile…</p>;
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;

  // Keyed by the contact values so the form re-seeds after a successful save
  // (which reloads `data`) without mirroring props into state via an effect.
  return <ProfileView key={`${data.phone ?? ""}|${data.address ?? ""}`} profile={data} onSaved={reload} />;
}

/**
 * The profile screen, seeded from a loaded profile.
 *
 * @param props.profile The employee's own profile.
 * @param props.onSaved Called after contact details are saved.
 * @returns The profile UI.
 */
function ProfileView({ profile: data, onSaved }: { profile: Profile; onSaved: () => void }) {
  const [phone, setPhone] = useState(data.phone ?? "");
  const [address, setAddress] = useState(data.address ?? "");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setProblem(null);
    setNotice(null);
    try {
      await api("/api/profile", {
        method: "PATCH",
        body: JSON.stringify({ phone, address }),
      });
      setNotice("Contact details saved.");
      onSaved();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={`${data.firstName} ${data.lastName}`}
        subtitle={data.code}
        actions={
          <Badge
            tone={
              data.status === "active"
                ? "success"
                : data.status === "probation"
                  ? "warning"
                  : "neutral"
            }
          >
            {data.status}
          </Badge>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Employment</CardTitle>
          </CardHeader>
          <CardBody>
            <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
              <dt className="text-zinc-500">Employee code</dt>
              <dd className="font-mono">{data.code}</dd>
              <dt className="text-zinc-500">Joined</dt>
              <dd className="font-mono">{data.joinDate}</dd>
              <dt className="text-zinc-500">Exit date</dt>
              <dd className="font-mono">{data.exitDate ?? "—"}</dd>
              <dt className="text-zinc-500">Status</dt>
              <dd>{data.status}</dd>
              <dt className="text-zinc-500">Gender</dt>
              <dd>{data.gender ?? "—"}</dd>
            </dl>
            <p className="mt-3 text-xs text-zinc-500">
              Department, designation and salary are managed by HR.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Contact details</CardTitle>
          </CardHeader>
          <CardBody>
            <form onSubmit={save} className="flex flex-col gap-3">
              <ErrorNote message={problem} />
              <SuccessNote message={notice} />
              <Field label="Phone" htmlFor="phone">
                <Input
                  id="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </Field>
              <Field label="Address" htmlFor="address">
                <Input
                  id="address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </Field>
              <div>
                <Button size="sm" type="submit" disabled={saving}>
                  {saving ? "Saving…" : "Save contact details"}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
