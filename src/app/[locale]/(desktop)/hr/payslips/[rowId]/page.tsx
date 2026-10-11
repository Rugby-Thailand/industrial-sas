import { setRequestLocale } from "next-intl/server";
import { HrPayslipsScreen } from "@/features/hr/EmployeePayslipsScreen";
export default async function Page({
  params,
}: {
  readonly params: Promise<{ locale: string; rowId: string }>;
}) {
  const { locale, rowId } = await params;
  setRequestLocale(locale);
  return <HrPayslipsScreen rowId={rowId} />;
}
