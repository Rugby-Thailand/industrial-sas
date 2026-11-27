import { setRequestLocale } from "next-intl/server";

import { CustomerLineSettings } from "@/features/customerLine/CustomerLineSettings";

export default async function CustomerLineSettingsPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <CustomerLineSettings />;
}
