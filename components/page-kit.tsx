"use client";

/**
 * @fileoverview Shared page scaffolding: headers, and loading/error/empty states.
 *
 * @description
 * Every list page repeats the same three states around its table. Centralizing
 * them keeps the pages short and guarantees consistent messaging — an errored
 * page always shows the server's own message, and a table with no rows always
 * says why rather than rendering an empty box.
 *
 * @implementation
 *
 * Step 1: `PageHeader` — title, subtitle and right-aligned actions.
 * Step 2: `StateBlock` — the single renderer for loading / error / empty.
 * Step 3: `ErrorNote` — inline error for forms and mutations.
 * Step 4: States are accessible (`role="status"` / `role="alert"`).
 * Step 5: Used by every page under `app/(app)`.
 * Step 6: Loading must never flash when `loading` is false on first paint.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

import { Alert } from "./ui/alert";

/**
 * Page title row.
 *
 * @param props.title    Page heading.
 * @param props.subtitle Optional supporting sentence.
 * @param props.actions  Optional right-aligned controls.
 * @returns The header block.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          {title}
        </h1>
        {subtitle && <p className="text-sm text-zinc-500">{subtitle}</p>}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  );
}

/**
 * Renders one of the three table states, or nothing when data is ready.
 *
 * @param props.loading  Whether a request is in flight.
 * @param props.error    Server error message, if any.
 * @param props.empty    Whether the data set is empty.
 * @param props.emptyText Copy for the empty state.
 * @param props.colSpan  Number of table columns to span.
 * @returns A `<tr>` state row, or `null` when the caller should render data.
 */
export function StateRow({
  loading,
  error,
  empty,
  emptyText = "Nothing here yet.",
  colSpan,
}: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  emptyText?: string;
  colSpan: number;
}) {
  if (loading) {
    return (
      <tr>
        <td
          colSpan={colSpan}
          className="px-3 py-8 text-center text-sm text-zinc-500"
          role="status"
        >
          Loading…
        </td>
      </tr>
    );
  }
  if (error) {
    return (
      <tr>
        <td
          colSpan={colSpan}
          className="px-3 py-8 text-center text-sm text-red-600"
          role="alert"
        >
          {error}
        </td>
      </tr>
    );
  }
  if (!empty) return null;
  return (
    <tr>
      <td
        colSpan={colSpan}
        className="px-3 py-8 text-center text-sm text-zinc-500"
      >
        {emptyText}
      </td>
    </tr>
  );
}

/**
 * Inline error message for a form or mutation.
 *
 * @param props.message Error text; renders nothing when null.
 * @returns An alert block or `null`.
 */
export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return <Alert tone="danger">{message}</Alert>;
}

/**
 * Inline success confirmation.
 *
 * @param props.message Confirmation text; renders nothing when null.
 * @returns An alert block or `null`.
 */
export function SuccessNote({ message }: { message: string | null }) {
  if (!message) return null;
  return <Alert tone="success">{message}</Alert>;
}
