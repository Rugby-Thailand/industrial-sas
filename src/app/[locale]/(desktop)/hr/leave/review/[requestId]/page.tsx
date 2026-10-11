import { setRequestLocale } from "next-intl/server";
import { HrLeaveReviewDetailScreen } from "@/features/hr/LeaveReviewScreen";
export default async function Page({
  params,
}: {
  readonly params: Promise<{ locale: string; requestId: string }>;
}) {
  const { locale, requestId } = await params;
  setRequestLocale(locale);
  return <HrLeaveReviewDetailScreen requestId={requestId} />;
}
