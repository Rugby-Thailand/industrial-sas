import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { ProductionBoard } from "@/features/production/ProductionBoard";

export default async function HandheldProductionPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Production");
  return (
    <>
      <PageHeader
        title={t("handheldTitle")}
        description={t("handheldDescription")}
      />
      <ProductionBoard />
    </>
  );
}
