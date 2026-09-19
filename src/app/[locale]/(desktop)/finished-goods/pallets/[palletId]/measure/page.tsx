import { setRequestLocale } from "next-intl/server";
import { PalletScreen } from "@/features/finishedGoods/PalletScreens";

export default async function Page({
  params,
}: {
  readonly params: Promise<{ locale: string; palletId: string }>;
}) {
  const { locale, palletId } = await params;
  setRequestLocale(locale);
  return <PalletScreen palletId={palletId} view="measure" />;
}
