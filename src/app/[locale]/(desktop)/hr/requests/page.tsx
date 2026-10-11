import { setRequestLocale } from "next-intl/server";

import { HrRequestsScreen } from "@/features/hr/RequestsScreen";

export default async function Page({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <HrRequestsScreen />;
}
