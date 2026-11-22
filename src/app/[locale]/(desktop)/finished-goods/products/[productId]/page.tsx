import { setRequestLocale } from "next-intl/server";
import { ProductScreen } from "@/features/finishedGoods/ProductScreen";

export default async function Page({
  params,
  searchParams,
}: {
  readonly searchParams: Promise<{
    resumePalletId?: string;
    warehouseId?: string;
  }>;
  readonly params: Promise<{ locale: string; productId: string }>;
}) {
  const { locale, productId } = await params;
  setRequestLocale(locale);
  const { resumePalletId, warehouseId } = await searchParams;
  return (
    <ProductScreen
      productId={productId}
      {...(resumePalletId ? { resumePalletId } : {})}
      {...(warehouseId ? { requestedWarehouseId: warehouseId } : {})}
    />
  );
}
