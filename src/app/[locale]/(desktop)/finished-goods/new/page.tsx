import { setRequestLocale } from "next-intl/server";
import { ProductScreen } from "@/features/finishedGoods/ProductScreens";

export default async function Page({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ProductScreen />;
}
