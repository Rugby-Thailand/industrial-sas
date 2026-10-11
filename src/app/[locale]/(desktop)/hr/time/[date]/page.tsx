import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { HrDayScreen } from "@/features/hr/DayScreen";

export default async function Page({
  params,
}: {
  readonly params: Promise<{ locale: string; date: string }>;
}) {
  const { locale, date } = await params;
  setRequestLocale(locale);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();
  return <HrDayScreen businessDate={date} />;
}
