import { setRequestLocale } from "next-intl/server";
import { JobScanRecordsScreen } from "@/features/finishedGoods/jobScan/JobScanRecords";
export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams: Promise<{ warehouseId?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { warehouseId } = await searchParams;
  return (
    <JobScanRecordsScreen
      {...(warehouseId ? { requestedWarehouseId: warehouseId } : {})}
    />
  );
}
