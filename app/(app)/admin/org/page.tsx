"use client";

/**
 * @fileoverview `/admin/org` — departments, designations, leave types, holidays.
 *
 * @description
 * Manages the four reference tables that define the company vocabulary. They
 * share one CRUD shape (`/api/org?type=…`), so the page is a tabbed editor
 * rather than four near-identical pages. Leave types are the most consequential:
 * their yearly quotas are what leave validation checks against.
 *
 * @implementation
 *
 * Step 1: Track the active tab and the list for it.
 * Step 2: Render a table per tab with the fields that tab cares about.
 * Step 3: "Add" opens a modal with the tab's fields.
 * Step 4: Delete asks for confirmation; departments in use are deactivated
 *         instead of removed (the API decides, the UI reports which happened).
 * Step 5: Every mutation reloads the list so the table is always truthful.
 * Step 6: Duplicate names/codes show the server's 409 message inline.
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
import { Card, CardBody } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { ConfirmButton, Modal } from "@/components/modal";
import {
  ErrorNote,
  PageHeader,
  StateRow,
  SuccessNote,
} from "@/components/page-kit";

type Tab = "department" | "designation" | "leaveType" | "holiday";

type Row = {
  id: string;
  name?: string;
  code?: string;
  yearlyQuota?: number | null;
  isPaid?: boolean;
  isActive?: boolean;
  date?: string;
};

const TABS: { key: Tab; label: string }[] = [
  { key: "department", label: "Departments" },
  { key: "designation", label: "Designations" },
  { key: "leaveType", label: "Leave types" },
  { key: "holiday", label: "Holidays" },
];

/**
 * Renders the reference-data editor.
 *
 * @returns The org page content.
 */
export default function AdminOrgPage() {
  const [tab, setTab] = useState<Tab>("department");
  const { data, error, loading, reload } = useJson<Row[]>(
    `/api/org?type=${tab}`,
    [tab],
  );

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [quota, setQuota] = useState("");
  const [paid, setPaid] = useState("true");
  const [date, setDate] = useState("");

  /** Resets the add-form and opens it for the current tab. */
  function openAdd() {
    setName("");
    setCode("");
    setQuota("");
    setPaid("true");
    setDate("");
    setProblem(null);
    setOpen(true);
  }

  /** Builds the payload for the current tab from the form fields. */
  function payload() {
    if (tab === "department") return { name };
    if (tab === "designation") return { name };
    if (tab === "holiday") return { date, name };
    return {
      code: code.trim().toLowerCase().replace(/\s+/g, "_"),
      name,
      yearlyQuota: quota.trim() === "" ? null : Number(quota),
      isPaid: paid === "true",
    };
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setProblem(null);
    try {
      await api(`/api/org?type=${tab}`, {
        method: "POST",
        body: JSON.stringify(payload()),
      });
      setOpen(false);
      setNotice("Added.");
      reload();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Could not add");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    const res = await api<{ deactivated?: boolean }>(
      `/api/org?type=${tab}&id=${id}`,
      { method: "DELETE" },
    );
    setNotice(
      res.deactivated
        ? "Department deactivated (it still has employees)."
        : "Deleted.",
    );
    reload();
  }

  const colSpan = tab === "leaveType" ? 4 : tab === "holiday" ? 3 : 3;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Departments & leave types"
        subtitle="Reference data used across employees, attendance, leave and payroll."
        actions={
          <Button size="sm" onClick={openAdd}>
            Add{" "}
            {TABS.find((t) => t.key === tab)
              ?.label.toLowerCase()
              .replace(/s$/, "")}
          </Button>
        }
      />

      <SuccessNote message={notice} />
      <ErrorNote message={error} />

      <div className="flex flex-wrap gap-1" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => {
              setTab(t.key);
              setNotice(null);
            }}
            className={`rounded-md px-3 py-1.5 text-sm ${
              tab === t.key
                ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card>
        <CardBody className="p-0">
          <Table>
            <thead>
              <tr>
                {tab === "holiday" ? <Th>Date</Th> : <Th>Name</Th>}
                {tab === "leaveType" && <Th>Code</Th>}
                {tab === "holiday" && <Th>Holiday</Th>}
                {tab === "leaveType" && <Th>Quota / year</Th>}
                {tab === "leaveType" && <Th>Paid</Th>}
                {tab === "department" && <Th>Status</Th>}
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              <StateRow
                loading={loading}
                error={error}
                empty={!loading && !error && (data?.length ?? 0) === 0}
                emptyText="Nothing here yet — add the first entry."
                colSpan={colSpan + 1}
              />
              {data?.map((row) => (
                <tr key={row.id}>
                  {tab === "holiday" ? (
                    <Td className="font-mono">{row.date}</Td>
                  ) : (
                    <Td className="font-medium">{row.name}</Td>
                  )}
                  {tab === "leaveType" && (
                    <Td className="font-mono text-xs">{row.code}</Td>
                  )}
                  {tab === "holiday" && <Td>{row.name}</Td>}
                  {tab === "leaveType" && (
                    <Td>{row.yearlyQuota ?? "Unlimited"}</Td>
                  )}
                  {tab === "leaveType" && (
                    <Td>
                      {row.isPaid ? (
                        <Badge tone="success">Paid</Badge>
                      ) : (
                        <Badge tone="warning">Unpaid</Badge>
                      )}
                    </Td>
                  )}
                  {tab === "department" && (
                    <Td>
                      {row.isActive ? (
                        <Badge tone="success">Active</Badge>
                      ) : (
                        <Badge>Inactive</Badge>
                      )}
                    </Td>
                  )}
                  <Td className="text-right">
                    <ConfirmButton
                      label="Delete"
                      message="This removes the entry. Departments with employees are deactivated instead."
                      onConfirm={() => remove(row.id)}
                      onDone={() => setNotice("Done.")}
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>

      <Modal
        open={open}
        title={`Add ${TABS.find((t) => t.key === tab)
          ?.label.toLowerCase()
          .replace(/s$/, "")}`}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={create} disabled={saving}>
              {saving ? "Saving…" : "Add"}
            </Button>
          </>
        }
      >
        <form onSubmit={create} className="flex flex-col gap-3">
          <ErrorNote message={problem} />

          {tab === "holiday" && (
            <Field label="Date" htmlFor="date">
              <Input
                id="date"
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
          )}

          {tab !== "holiday" && (
            <Field
              label={tab === "leaveType" ? "Display name" : "Name"}
              htmlFor="name"
            >
              <Input
                id="name"
                required
                minLength={2}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
          )}

          {tab === "holiday" && (
            <Field label="Holiday name" htmlFor="holidayName">
              <Input
                id="holidayName"
                required
                minLength={2}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
          )}

          {tab === "leaveType" && (
            <>
              <Field label="Code" hint="Lowercase, e.g. annual" htmlFor="code">
                <Input
                  id="code"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </Field>
              <Field
                label="Yearly quota"
                hint="Leave blank for unlimited"
                htmlFor="quota"
              >
                <Input
                  id="quota"
                  type="number"
                  min={0}
                  max={365}
                  value={quota}
                  onChange={(e) => setQuota(e.target.value)}
                />
              </Field>
              <Field label="Paid" htmlFor="paid">
                <Select
                  id="paid"
                  value={paid}
                  onChange={(e) => setPaid(e.target.value)}
                >
                  <option value="true">Paid</option>
                  <option value="false">Unpaid</option>
                </Select>
              </Field>
            </>
          )}
        </form>
      </Modal>
    </div>
  );
}
