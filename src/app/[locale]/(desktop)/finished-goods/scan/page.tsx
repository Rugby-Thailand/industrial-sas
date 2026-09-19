import { setRequestLocale } from "next-intl/server";
import { PackageScanningScreen } from "@/features/finishedGoods/PackageScanningScreen";
export default async function Page({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <PackageScanningScreen />;
}
