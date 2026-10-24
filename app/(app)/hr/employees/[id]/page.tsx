import { Employee360Page } from "@/components/employees/employee-360";

/**
 * @fileoverview `/hr/employees/[id]` — Employee 360 (HR view).
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */
export default function Page({ params }: PageProps<"/hr/employees/[id]">) {
  return <Employee360Page params={params} basePath="/hr" />;
}
