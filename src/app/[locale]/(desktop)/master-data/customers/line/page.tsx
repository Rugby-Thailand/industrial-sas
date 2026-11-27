import { setRequestLocale } from "next-intl/server";

import { CustomerLineInbox } from "@/features/customerLine/CustomerLineInbox";

export default async function CustomerLinePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams: Promise<{ customerId?: string | string[] }>;
}) {
  const [{ locale }, { customerId }] = await Promise.all([
    params,
    searchParams,
  ]);
  setRequestLocale(locale);
  return (
    <CustomerLineInbox
      {...(typeof customerId === "string" ? { customerId } : {})}
    />
  );
}
