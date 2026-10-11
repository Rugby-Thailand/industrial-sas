import { setRequestLocale } from "next-intl/server";

import { HrHolidaysScreen } from "@/features/hr/HolidaysScreen";

export default async function Page({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <HrHolidaysScreen />;
}
