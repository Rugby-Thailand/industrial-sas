import { setRequestLocale } from "next-intl/server";

import { HrReviewScreen } from "@/features/hr/ReviewScreen";

export default async function Page({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <HrReviewScreen />;
}
