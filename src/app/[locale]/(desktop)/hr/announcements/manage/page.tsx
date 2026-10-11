import { setRequestLocale } from "next-intl/server";
import { HrAnnouncementManageScreen } from "@/features/hr/AnnouncementManageScreen";
export default async function Page({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <HrAnnouncementManageScreen />;
}
