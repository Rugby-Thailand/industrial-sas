import { setRequestLocale } from "next-intl/server";

import { NewCustomerForm } from "@/features/customers/CustomerForm";

export default async function NewCustomerPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <NewCustomerForm />;
}
