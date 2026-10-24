import type { ComponentProps } from "react";

export function Card({ className = "", ...props }: ComponentProps<"div">) {
  return (
    <div
      {...props}
      className={`rounded-lg border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 ${className}`}
    />
  );
}

export function CardHeader({
  className = "",
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      {...props}
      className={`flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800 ${className}`}
    />
  );
}

export function CardTitle({ className = "", ...props }: ComponentProps<"h2">) {
  return (
    <h2
      {...props}
      className={`text-sm font-semibold text-zinc-900 dark:text-zinc-50 ${className}`}
    />
  );
}

export function CardBody({ className = "", ...props }: ComponentProps<"div">) {
  return <div {...props} className={`px-4 py-3 ${className}`} />;
}
