import { setRequestLocale } from "next-intl/server";

import { DashboardScreen } from "@/features/dashboard/DashboardScreen";

export default async function Page({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <DashboardScreen />;
}
