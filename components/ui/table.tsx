import type { ComponentProps } from "react";

export function Table({ className = "", ...props }: ComponentProps<"table">) {
  return (
    <div className="overflow-x-auto">
      <table
        {...props}
        className={`w-full border-collapse text-left text-sm ${className}`}
      />
    </div>
  );
}

export function Th({ className = "", ...props }: ComponentProps<"th">) {
  return (
    <th
      {...props}
      className={`border-b border-zinc-200 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800 ${className}`}
    />
  );
}

export function Td({ className = "", ...props }: ComponentProps<"td">) {
  return (
    <td
      {...props}
      className={`border-b border-zinc-100 px-3 py-2 text-zinc-700 dark:border-zinc-900 dark:text-zinc-300 ${className}`}
    />
  );
}

export function EmptyRow({
  colSpan,
  children = "Nothing here yet.",
}: {
  colSpan: number;
  children?: React.ReactNode;
}) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className="px-3 py-6 text-center text-sm text-zinc-500"
      >
        {children}
      </td>
    </tr>
  );
}
