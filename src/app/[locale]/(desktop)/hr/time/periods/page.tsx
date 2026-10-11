import { setRequestLocale } from "next-intl/server";
import { HrFrozenPeriodsScreen } from "@/features/hr/FrozenPeriodsScreen";
export default async function Page({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <HrFrozenPeriodsScreen />;
}
