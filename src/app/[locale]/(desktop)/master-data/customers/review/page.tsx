import { setRequestLocale } from "next-intl/server";

import { CustomerReviewQueue } from "@/features/customers/CustomerReviewQueue";

export default async function CustomerReviewPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <CustomerReviewQueue />;
}
