import { setRequestLocale } from "next-intl/server";
import { MoveScreen } from "@/features/finishedGoods/MoveScreen";

export default async function Page({
  params,
}: {
  readonly params: Promise<{ locale: string; palletId: string }>;
}) {
  const { locale, palletId } = await params;
  setRequestLocale(locale);
  return <MoveScreen palletId={palletId} />;
}
