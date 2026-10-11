import { setRequestLocale } from "next-intl/server";

import { HrLeaveReviewScreen } from "@/features/hr/LeaveReviewScreen";

export default async function Page({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <HrLeaveReviewScreen />;
}
