import { setRequestLocale } from "next-intl/server";

import { HrRosterScreen } from "@/features/hr/ShiftsRoster";

export default async function Page({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <HrRosterScreen />;
}
