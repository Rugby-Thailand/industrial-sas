import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { OpeningStockWorkbench } from "@/features/counting/OpeningStockWorkbench";

export default async function OpeningStockPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Count");
  return (
    <>
      <PageHeader
        title={t("openingTitle")}
        description={t("openingDescription")}
      />
      <OpeningStockWorkbench />
    </>
  );
}
