import { setRequestLocale } from "next-intl/server";
import { PackingScreen } from "@/features/finishedGoods/PackingScreen";
export default async function Page({
  params,
}: {
  readonly params: Promise<{ locale: string; batchId: string }>;
}) {
  const { locale, batchId } = await params;
  setRequestLocale(locale);
  return <PackingScreen batchId={batchId} />;
}
