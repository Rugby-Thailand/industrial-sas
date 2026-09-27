import { setRequestLocale } from "next-intl/server";
import { JobScanRecordsScreen } from "@/features/finishedGoods/jobScan/JobScanRecords";
export default async function Page({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <JobScanRecordsScreen />;
}
