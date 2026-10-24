"use client";

/**
 * @fileoverview Modal dialog and confirmation prompt.
 *
 * @description
 * Pages need one consistent overlay for forms (register employee, edit
 * settings, post announcement) and for destructive confirmations. This wraps
 * the native `<dialog>` element, which gives focus trapping, Escape-to-close
 * and the top-layer backdrop for free instead of reimplementing them.
 *
 * @implementation
 *
 * Step 1: Render `<dialog>` with a title, body and footer actions.
 * Step 2: Open/close is driven by the `open` prop via `showModal()`/`close()`.
 * Step 3: Escape and backdrop clicks call `onClose`.
 * Step 4: The footer holds cancel/confirm buttons supplied by the caller.
 * Step 5: `ConfirmButton` wraps the async-delete pattern with a busy state.
 * Step 6: A closed dialog must not keep the page scroll locked.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";

/**
 * A modal dialog.
 *
 * @param props.open     Whether the dialog is visible.
 * @param props.title    Heading text.
 * @param props.onClose  Called on Escape, backdrop click or Cancel.
 * @param props.children Dialog body.
 * @param props.footer   Optional footer content (defaults to a Cancel button).
 * @returns The dialog element.
 */
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // Clicks land on the dialog itself only when they hit the backdrop.
        if (e.target === ref.current) onClose();
      }}
      className="m-auto w-full max-w-lg rounded-lg border-zinc-200 bg-white p-0 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
      style={wide ? { maxWidth: "44rem" } : undefined}
    >
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-semibold">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded px-2 text-lg leading-none text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
        >
          ×
        </button>
      </div>
      <div className="max-h-[70vh] overflow-y-auto px-4 py-4">{children}</div>
      <div className="flex justify-end gap-2 border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
        {footer ?? (
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
        )}
      </div>
    </dialog>
  );
}

/**
 * A destructive action button that asks for confirmation first.
 *
 * @param props.label      Button text.
 * @param props.message    Confirmation sentence shown in the dialog.
 * @param props.onConfirm  Performs the action; may throw to show an error.
 * @param props.onDone     Called after a successful action (typically `reload`).
 * @returns The button plus its confirmation dialog.
 */
export function ConfirmButton({
  label,
  message,
  onConfirm,
  onDone,
  variant = "danger",
}: {
  label: string;
  message: string;
  onConfirm: () => Promise<unknown>;
  onDone?: () => void;
  variant?: "danger" | "secondary";
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      setOpen(false);
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Modal
        open={open}
        title={label}
        onClose={() => !busy && setOpen(false)}
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={run} disabled={busy}>
              {busy ? "Working…" : "Confirm"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{message}</p>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </Modal>
    </>
  );
}
