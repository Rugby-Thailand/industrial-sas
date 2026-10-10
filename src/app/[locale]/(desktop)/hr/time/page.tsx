import { setRequestLocale } from "next-intl/server";

import { HrHistoryScreen } from "@/features/hr/HistoryScreen";

export default async function Page({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <HrHistoryScreen />;
}
