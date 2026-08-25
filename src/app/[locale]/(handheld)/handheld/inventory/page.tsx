import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { BalancesPanel } from "@/features/inventory/BalancesPanel";

export default async function HandheldInventoryPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Handheld");

  return (
    <>
      <PageHeader
        title={t("lookupTitle")}
        description={t("lookupDescription")}
      />
      <BalancesPanel />
    </>
  );
}
