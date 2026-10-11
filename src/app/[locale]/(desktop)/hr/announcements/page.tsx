import { setRequestLocale } from "next-intl/server";
import { HrAnnouncementsScreen } from "@/features/hr/AnnouncementsScreen";
export default async function Page({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <HrAnnouncementsScreen />;
}
