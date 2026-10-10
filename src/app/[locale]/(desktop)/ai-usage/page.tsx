import { setRequestLocale } from "next-intl/server";
import { AiUsageScreen } from "@/features/aiUsage/AiUsageScreen";
export default async function Page({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AiUsageScreen />;
}
