import { setRequestLocale } from "next-intl/server";
import { ProductScreen } from "@/features/finishedGoods/ProductScreens";

export default async function Page({
  params,
  searchParams,
}: {
  readonly searchParams: Promise<{ resumePalletId?: string }>;
  readonly params: Promise<{ locale: string; productId: string }>;
}) {
  const { locale, productId } = await params;
  setRequestLocale(locale);
  const { resumePalletId } = await searchParams;
  return (
    <ProductScreen
      productId={productId}
      {...(resumePalletId ? { resumePalletId } : {})}
    />
  );
}
