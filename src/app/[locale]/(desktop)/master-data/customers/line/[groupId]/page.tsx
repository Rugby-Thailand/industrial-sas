import { setRequestLocale } from "next-intl/server";

import { CustomerLineGroup } from "@/features/customerLine/CustomerLineGroup";

export default async function CustomerLineGroupPage({
  params,
}: {
  readonly params: Promise<{ locale: string; groupId: string }>;
}) {
  const { locale, groupId } = await params;
  setRequestLocale(locale);
  return <CustomerLineGroup groupId={groupId} />;
}
