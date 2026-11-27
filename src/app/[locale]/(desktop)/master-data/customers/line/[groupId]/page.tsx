import { setRequestLocale } from "next-intl/server";

import { CustomerLineGroup } from "@/features/customerLine/CustomerLineGroup";

export default async function CustomerLineGroupPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ locale: string; groupId: string }>;
  readonly searchParams?: Promise<{ customerId?: string | string[] }>;
}) {
  const [{ locale, groupId }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  const customerId = query?.customerId;
  setRequestLocale(locale);
  return (
    <CustomerLineGroup
      groupId={groupId}
      {...(typeof customerId === "string"
        ? { suggestedCustomerId: customerId }
        : {})}
    />
  );
}
