import { setRequestLocale } from "next-intl/server";
import { HrPayslipImportScreen } from "@/features/hr/PayslipImportScreen";
export default async function Page({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <HrPayslipImportScreen />;
}
