import { Employee360Page } from "@/components/employees/employee-360";

/**
 * @fileoverview `/admin/employees/[id]` — Employee 360.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */
export default function Page({ params }: PageProps<"/admin/employees/[id]">) {
  return <Employee360Page params={params} basePath="/admin" />;
}
