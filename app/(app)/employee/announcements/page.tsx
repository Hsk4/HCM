import { AnnouncementFeed } from "@/components/announcements/announcement-feed";

/**
 * @fileoverview `/employee/announcements` — read-only feed.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */
export default function EmployeeAnnouncementsPage() {
  return <AnnouncementFeed canPost={false} />;
}
