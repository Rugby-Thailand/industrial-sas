import { setRequestLocale } from "next-intl/server";

import { HrProfileScreen } from "@/features/hr/ProfileScreen";

export default async function Page({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <HrProfileScreen />;
}
