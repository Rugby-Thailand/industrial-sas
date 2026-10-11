import { setRequestLocale } from "next-intl/server";

import { HrEmployeesScreen } from "@/features/hr/EmployeesScreen";

export default async function Page({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <HrEmployeesScreen />;
}
