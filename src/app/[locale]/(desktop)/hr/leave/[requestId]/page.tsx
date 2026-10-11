import { setRequestLocale } from "next-intl/server";
import { HrLeaveDetailScreen } from "@/features/hr/LeaveDetailScreen";

export default async function Page({
  params,
}: {
  readonly params: Promise<{ locale: string; requestId: string }>;
}) {
  const { locale, requestId } = await params;
  setRequestLocale(locale);
  return <HrLeaveDetailScreen requestId={requestId} />;
}
