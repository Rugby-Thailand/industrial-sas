import { setRequestLocale } from "next-intl/server";

import { EditCustomerForm } from "@/features/customers/CustomerScreens";

export default async function EditCustomerPage({
  params,
}: {
  readonly params: Promise<{ locale: string; customerId: string }>;
}) {
  const { locale, customerId } = await params;
  setRequestLocale(locale);
  return <EditCustomerForm customerId={customerId} />;
}
