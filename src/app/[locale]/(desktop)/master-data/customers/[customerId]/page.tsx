import { setRequestLocale } from "next-intl/server";

import { CustomerDetail } from "@/features/customers/CustomerDetail";

export default async function CustomerPage({
  params,
}: {
  readonly params: Promise<{ locale: string; customerId: string }>;
}) {
  const { locale, customerId } = await params;
  setRequestLocale(locale);
  return <CustomerDetail customerId={customerId} />;
}
