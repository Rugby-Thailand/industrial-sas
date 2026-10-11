import { setRequestLocale } from "next-intl/server";
import { HrFrozenPeriodDetailScreen } from "@/features/hr/FrozenPeriodsScreen";
export default async function Page({
  params,
}: {
  readonly params: Promise<{ locale: string; versionId: string }>;
}) {
  const { locale, versionId } = await params;
  setRequestLocale(locale);
  return <HrFrozenPeriodDetailScreen versionId={versionId} />;
}
