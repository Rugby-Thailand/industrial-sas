import { setRequestLocale } from "next-intl/server";

import { HrSettingsScreen } from "@/features/hr/SettingsScreen";

export default async function Page({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <HrSettingsScreen />;
}
