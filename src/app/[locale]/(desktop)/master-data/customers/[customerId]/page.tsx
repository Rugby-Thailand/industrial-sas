import { setRequestLocale } from "next-intl/server";

import { CustomerWorkspace } from "@/features/customers/CustomerWorkspace";

export default async function CustomerPage({
  params,
}: {
  readonly params: Promise<{ locale: string; customerId: string }>;
}) {
  const { locale, customerId } = await params;
  setRequestLocale(locale);
  return <CustomerWorkspace customerId={customerId} />;
}
