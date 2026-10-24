"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (next !== confirm) return setError("New passwords do not match");
    if (next.length < 8)
      return setError("New password must be at least 8 characters");

    setBusy(true);
    try {
      await api("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ current, next }),
      });
      setDone(true);
      setTimeout(() => {
        router.push("/");
        router.refresh();
      }, 800);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not change password",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <div className="w-full max-w-sm rounded-lg border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Change password
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Temporary passwords must be changed before you can continue.
        </p>

        <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
          <Field label="Current password" htmlFor="current">
            <Input
              id="current"
              type="password"
              autoComplete="current-password"
              required
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Field>
          <Field
            label="New password"
            hint="At least 8 characters"
            htmlFor="next"
          >
            <Input
              id="next"
              type="password"
              autoComplete="new-password"
              required
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </Field>
          <Field label="Confirm new password" htmlFor="confirm">
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>

          {error && <Alert tone="danger">{error}</Alert>}
          {done && <Alert tone="success">Password updated. Redirecting…</Alert>}

          <Button type="submit" disabled={busy || done}>
            {busy ? "Saving…" : "Save new password"}
          </Button>
        </form>
      </div>
    </main>
  );
}
