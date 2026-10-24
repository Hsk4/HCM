import { requireRole } from "@/server/auth/guard";
import { Shell } from "@/components/shell";
import { HR_MENU } from "@/components/index";

// Session-guarded segment: blocks on the server rather than prerendering a
// static shell (see app/(app)/admin/layout.tsx).
export const instant = false;

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireRole(["HR"]);
  return (
    <Shell user={user} menu={HR_MENU}>
      {children}
    </Shell>
  );
}
