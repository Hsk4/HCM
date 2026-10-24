import { AnnouncementFeed } from "@/components/announcements/announcement-feed";

/**
 * @fileoverview `/admin/announcements` — publish and manage announcements.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */
export default function AdminAnnouncementsPage() {
  return <AnnouncementFeed canPost />;
}
