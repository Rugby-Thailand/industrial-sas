import { setRequestLocale } from "next-intl/server";

import { HrPeriodDetailScreen } from "@/features/hr/PeriodDetailScreen";

export default async function Page({
  params,
}: {
  readonly params: Promise<{ locale: string; periodId: string }>;
}) {
  const { locale, periodId } = await params;
  setRequestLocale(locale);
  return <HrPeriodDetailScreen periodId={periodId} />;
}
