import { setRequestLocale } from "next-intl/server";
import { HrAnnouncementDetailScreen } from "@/features/hr/AnnouncementsScreen";
export default async function Page({
  params,
}: {
  readonly params: Promise<{ locale: string; announcementId: string }>;
}) {
  const { locale, announcementId } = await params;
  setRequestLocale(locale);
  return <HrAnnouncementDetailScreen announcementId={announcementId} />;
}
