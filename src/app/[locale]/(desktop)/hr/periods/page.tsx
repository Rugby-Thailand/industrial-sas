import { setRequestLocale } from "next-intl/server";

import { HrPeriodsScreen } from "@/features/hr/PeriodsScreen";

export default async function Page({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <HrPeriodsScreen />;
}
