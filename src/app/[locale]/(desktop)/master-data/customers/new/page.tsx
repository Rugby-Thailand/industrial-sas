import { setRequestLocale } from "next-intl/server";

import { NewCustomerForm } from "@/features/customers/CustomerForm";
import { isReviewPrefillToken } from "@/features/customers/reviewPrefill";

export default async function NewCustomerPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams?: Promise<{ prefill?: string | string[] }>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const rawPrefill = Array.isArray(query?.prefill)
    ? query.prefill[0]
    : query?.prefill;
  const prefillToken = isReviewPrefillToken(rawPrefill)
    ? rawPrefill
    : undefined;
  return (
    <NewCustomerForm
      {...(prefillToken === undefined ? {} : { prefillToken })}
    />
  );
}
