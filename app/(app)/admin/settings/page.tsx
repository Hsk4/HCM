"use client";

/**
 * @fileoverview `/admin/settings` — company rules editor.
 *
 * @description
 * Edits the singleton `settings` row. These values drive lateness, half-day
 * detection, working-day counts and the geofence, so the form explains each
 * field and warns about the ones whose change only affects *future* records
 * (payroll that is already finalized is never recomputed).
 *
 * @implementation
 *
 * Step 1: Load the current settings.
 * Step 2: Show fields grouped by area: company, office rules, geofence.
 * Step 3: Numbers are kept as strings while editing and converted on submit.
 * Step 4: `PATCH /api/settings`; show success or the server's error.
 * Step 5: Reloading the page must show the saved values.
 * Step 6: Invalid time/kind values are blocked client-side and server-side.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

import { useState } from "react";
import { api } from "@/lib/api";
import { useJson } from "@/lib/use-json";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { ErrorNote, PageHeader, SuccessNote } from "@/components/page-kit";

type Settings = {
  companyName: string;
  officeStart: string;
  graceMinutes: number;
  halfDayMinutes: number;
  weekendDays: number[];
  officeLat: number | null;
  officeLng: number | null;
  officeRadiusM: number;
  timezone: string;
  /** Server timestamp; also used as the form's React key to reset after save. */
  updatedAt: string;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Convert a form string to a number, treating blanks as `null`. */
const num = (v: string) => (v.trim() === "" ? null : Number(v));

/**
 * Renders the settings form.
 *
 * @returns The settings page content.
 */
export default function AdminSettingsPage() {
  const { data, error, loading, reload } = useJson<Settings>("/api/settings");

  // The header is part of the static shell: it renders from the server even
  // before the client fetch resolves, so the route never appears blank.
  const header = (
    <PageHeader
      title="Company settings"
      subtitle="Rules used by attendance, leave and payroll. Changes apply to future records only."
    />
  );

  if (loading && !data) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <p className="text-sm text-zinc-500">Loading settings…</p>
      </div>
    );
  }
  if (error && !data) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <ErrorNote message={error} />
      </div>
    );
  }
  if (!data) return header;

  // Remount the form whenever the server copy changes (initial load, or after
  // a save bumps `updatedAt`) so its state always starts from fresh data.
  return <SettingsForm key={data.updatedAt} initial={data} onSaved={reload} />;
}

/**
 * The editable form, seeded from the loaded settings.
 *
 * @param props.initial Settings as loaded from the server.
 * @param props.onSaved Called after a successful save.
 * @returns The form UI.
 */
function SettingsForm({ initial, onSaved }: { initial: Settings; onSaved: () => void }) {
  const [form, setForm] = useState<Settings>(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setProblem(null);
    setSaved(null);
    try {
      await api("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({
          companyName: form.companyName,
          officeStart: form.officeStart,
          graceMinutes: Number(form.graceMinutes),
          halfDayMinutes: Number(form.halfDayMinutes),
          weekendDays: form.weekendDays,
          officeLat: form.officeLat,
          officeLng: form.officeLng,
          officeRadiusM: Number(form.officeRadiusM),
          timezone: form.timezone,
        }),
      });
      setSaved("Settings saved.");
      onSaved();
    } catch (err) {
      setProblem(
        err instanceof Error ? err.message : "Could not save settings",
      );
    } finally {
      setSaving(false);
    }
  }

  /** Toggles a weekday in the weekend list. */
  function toggleDay(day: number) {
    if (!form) return;
    const next = form.weekendDays.includes(day)
      ? form.weekendDays.filter((d) => d !== day)
      : [...form.weekendDays, day].sort();
    setForm({ ...form, weekendDays: next });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Company settings"
        subtitle="Rules used by attendance, leave and payroll. Changes apply to future records only."
        actions={
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        }
      />

      <SuccessNote message={saved} />
      <ErrorNote message={problem} />

      <form onSubmit={save} className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Company</CardTitle>
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            <Field label="Company name" htmlFor="companyName">
              <Input
                id="companyName"
                required
                value={form.companyName}
                onChange={(e) =>
                  setForm({ ...form, companyName: e.target.value })
                }
              />
            </Field>
            <Field
              label="Timezone"
              hint="IANA name, e.g. Asia/Karachi"
              htmlFor="timezone"
            >
              <Input
                id="timezone"
                required
                value={form.timezone}
                onChange={(e) => setForm({ ...form, timezone: e.target.value })}
              />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Office rules</CardTitle>
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Office start" hint="HH:MM" htmlFor="officeStart">
                <Input
                  id="officeStart"
                  type="time"
                  required
                  value={form.officeStart}
                  onChange={(e) =>
                    setForm({ ...form, officeStart: e.target.value })
                  }
                />
              </Field>
              <Field label="Grace (minutes)" htmlFor="grace">
                <Input
                  id="grace"
                  type="number"
                  min={0}
                  max={120}
                  required
                  value={form.graceMinutes}
                  onChange={(e) =>
                    setForm({ ...form, graceMinutes: Number(e.target.value) })
                  }
                />
              </Field>
            </div>
            <Field
              label="Half day below (minutes)"
              hint="Worked minutes below this count as a half day"
              htmlFor="halfDay"
            >
              <Input
                id="halfDay"
                type="number"
                min={30}
                max={720}
                required
                value={form.halfDayMinutes}
                onChange={(e) =>
                  setForm({ ...form, halfDayMinutes: Number(e.target.value) })
                }
              />
            </Field>
            <div>
              <p className="mb-1 text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Weekend days
              </p>
              <div className="flex flex-wrap gap-1">
                {WEEKDAYS.map((label, day) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => toggleDay(day)}
                    aria-pressed={form.weekendDays.includes(day)}
                    className={`rounded-md border px-2 py-1 text-xs ${
                      form.weekendDays.includes(day)
                        ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                        : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Office location (geofence)</CardTitle>
          </CardHeader>
          <CardBody className="grid gap-3 sm:grid-cols-3">
            <Field label="Latitude" htmlFor="lat">
              <Input
                id="lat"
                type="number"
                step="any"
                value={form.officeLat ?? ""}
                onChange={(e) =>
                  setForm({ ...form, officeLat: num(e.target.value) })
                }
              />
            </Field>
            <Field label="Longitude" htmlFor="lng">
              <Input
                id="lng"
                type="number"
                step="any"
                value={form.officeLng ?? ""}
                onChange={(e) =>
                  setForm({ ...form, officeLng: num(e.target.value) })
                }
              />
            </Field>
            <Field label="Radius (metres)" htmlFor="radius">
              <Input
                id="radius"
                type="number"
                min={10}
                max={10000}
                value={form.officeRadiusM}
                onChange={(e) =>
                  setForm({ ...form, officeRadiusM: Number(e.target.value) })
                }
              />
            </Field>
          </CardBody>
        </Card>
      </form>
    </div>
  );
}
