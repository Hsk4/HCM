import { requireRole } from "@/server/auth/guard";
import { Shell } from "@/components/shell";
import { ADMIN_MENU } from "@/components/index";

// Reads the session (cookies) at the top level to guard the whole segment, so
// this route blocks on the server instead of prerendering a static shell.
// Documented opt-out for session-reading segments under Cache Components.
export const instant = false;

export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await requireRole(["ADMIN"]);
  return <Shell user={user} menu={ADMIN_MENU}>{children}</Shell>;
}