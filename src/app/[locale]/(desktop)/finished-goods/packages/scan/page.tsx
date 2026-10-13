import { PackageScanScreen } from "@/features/finishedGoods/PackageScanScreen";

export default async function PackageScanPage({
  searchParams,
}: {
  searchParams: Promise<{ unitId?: string; batchId?: string }>;
}) {
  const context = await searchParams;
  return (
    <PackageScanScreen
      {...(typeof context.unitId === "string"
        ? { unitId: context.unitId }
        : {})}
      {...(typeof context.batchId === "string"
        ? { batchId: context.batchId }
        : {})}
    />
  );
}
