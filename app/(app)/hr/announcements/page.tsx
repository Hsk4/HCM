import { AnnouncementFeed } from "@/components/announcements/announcement-feed";

/**
 * @fileoverview `/hr/announcements` — HR can publish announcements.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */
export default function HrAnnouncementsPage() {
  return <AnnouncementFeed canPost />;
}
