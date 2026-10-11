import { setRequestLocale } from "next-intl/server";

import { HrShortcutCustomizeScreen } from "@/features/hr/ShortcutCustomizeScreen";

export default async function Page({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <HrShortcutCustomizeScreen />;
}
