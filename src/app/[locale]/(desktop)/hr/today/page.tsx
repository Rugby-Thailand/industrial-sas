import { setRequestLocale } from "next-intl/server";

import { HrTodayScreen } from "@/features/hr/TodayScreen";

export default async function Page({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <HrTodayScreen />;
}
