import { setRequestLocale } from "next-intl/server";
import { StackScreen } from "@/features/finishedGoods/StackScreen";
export default async function Page({
  params,
}: {
  readonly params: Promise<{ locale: string; palletId: string }>;
}) {
  const { locale, palletId } = await params;
  setRequestLocale(locale);
  return <StackScreen palletId={palletId} />;
}
