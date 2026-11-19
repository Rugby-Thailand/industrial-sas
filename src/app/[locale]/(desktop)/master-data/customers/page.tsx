import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { CustomerCatalogue } from "@/features/customers/CustomerScreens";

export default async function CustomersPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Customers");
  return (
    <>
      <PageHeader
        title={t("title")}
        summary={t("summary")}
        backFallbackHref={null}
      />
      {/* New customer sits beside the search field. */}
      <CustomerCatalogue />
    </>
  );
}
