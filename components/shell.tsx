"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { AiPanel } from "./ai-panel";

export type MenuItem = { href: string; label: string };

// Declared locally so importing the shell never pulls server-only session code
// (and env.ts) into a client bundle.
type ShellUser = { email: string; role: "ADMIN" | "HR" | "EMPLOYEE" };

export function Shell({
  user,
  menu,
  children,
}: {
  user: ShellUser;
  menu: MenuItem[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const nav = (
    <nav className="flex flex-col gap-0.5">
      {menu.map((item) => {
        // "/admin" must not stay active on "/admin/employees".
        const active =
          item.href === pathname ||
          (item.href !== `/${user.role.toLowerCase()}` &&
            pathname.startsWith(`${item.href}/`));
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMobileOpen(false)}
            className={`rounded-md px-3 py-2 text-sm transition-colors ${
              active
                ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  const roleLabel =
    user.role === "ADMIN" ? "Admin" : user.role === "HR" ? "HR" : "Employee";

  return (
    <div className="flex min-h-dvh flex-col bg-zinc-50 dark:bg-black">
      <header className="flex h-14 items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Toggle menu"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((v) => !v)}
            className="rounded-md border border-zinc-300 px-2 py-1 text-sm lg:hidden dark:border-zinc-700"
          >
            ☰
          </button>
          <Link
            href={`/${user.role.toLowerCase()}`}
            className="font-semibold text-zinc-900 dark:text-zinc-50"
          >
            HCM Lite
          </Link>
          <span className="hidden rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 sm:inline dark:bg-zinc-900 dark:text-zinc-400">
            {roleLabel}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-zinc-500 sm:inline">
            {user.email}
          </span>
          <Link
            href="/change-password"
            className="text-xs text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400"
          >
            Change password
          </Link>
          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              className="text-xs text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <div className="flex flex-1">
        <aside className="hidden w-60 shrink-0 border-r border-zinc-200 bg-white p-3 lg:block dark:border-zinc-800 dark:bg-zinc-950">
          {nav}
        </aside>

        {mobileOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div
              className="absolute inset-0 bg-black/30"
              onClick={() => setMobileOpen(false)}
            />
            <aside className="absolute inset-y-0 left-0 w-64 overflow-y-auto border-r border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
              {nav}
            </aside>
          </div>
        )}

        <main className="flex min-w-0 flex-1 flex-col p-4 sm:p-6">
          {children}
        </main>

        {/* AI chat panel: desktop column, stacked below content on small screens. */}
        <aside className="hidden w-80 shrink-0 border-l border-zinc-200 bg-white xl:block dark:border-zinc-800 dark:bg-zinc-950">
          <AiPanel role={user.role} />
        </aside>
      </div>

      <section className="border-t border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 xl:hidden">
        <div className="h-[60vh]">
          <AiPanel role={user.role} />
        </div>
      </section>
    </div>
  );
}
