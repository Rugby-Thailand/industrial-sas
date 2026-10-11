import { setRequestLocale } from "next-intl/server";

import { HrRequestDetailScreen } from "@/features/hr/RequestsScreen";

export default async function Page({
  params,
}: {
  readonly params: Promise<{ locale: string; requestId: string }>;
}) {
  const { locale, requestId } = await params;
  setRequestLocale(locale);
  return <HrRequestDetailScreen requestId={requestId} />;
}
