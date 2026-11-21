import { setRequestLocale } from "next-intl/server";

import { NewCustomerForm } from "@/features/customers/CustomerForm";

export default async function NewCustomerPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams?: Promise<{ name?: string | string[] }>;
}) {
  const [{ locale }, query] = await Promise.all([
    params,
    searchParams ?? Promise.resolve({} as { name?: string | string[] }),
  ]);
  setRequestLocale(locale);
  const rawName = Array.isArray(query.name) ? query.name[0] : query.name;
  const initialName = rawName?.trim().slice(0, 200) || undefined;
  return (
    <NewCustomerForm {...(initialName === undefined ? {} : { initialName })} />
  );
}
