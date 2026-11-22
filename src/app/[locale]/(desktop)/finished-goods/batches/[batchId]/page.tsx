import { setRequestLocale } from "next-intl/server";
import { PackingScreen } from "@/features/finishedGoods/PackingScreen";
export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ locale: string; batchId: string }>;
  readonly searchParams?: Promise<{ warehouseId?: string }>;
}) {
  const [{ locale, batchId }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  setRequestLocale(locale);
  const requestedWarehouseId =
    typeof query?.warehouseId === "string" && query.warehouseId.trim()
      ? query.warehouseId
      : undefined;
  return (
    <PackingScreen
      batchId={batchId}
      {...(requestedWarehouseId ? { requestedWarehouseId } : {})}
    />
  );
}
