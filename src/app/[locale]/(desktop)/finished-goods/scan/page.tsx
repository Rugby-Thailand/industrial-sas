import { setRequestLocale } from "next-intl/server";
import { JobScanScreen } from "@/features/finishedGoods/jobScan/JobScanScreen";
export default async function Page({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <JobScanScreen />;
}
