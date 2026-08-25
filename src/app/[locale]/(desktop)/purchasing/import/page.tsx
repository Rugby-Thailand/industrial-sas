import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/ui/PageHeader";
import { ImportWorkbench } from "@/features/inbound/ImportWorkbench";

export default async function PurchaseImportPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Purchasing");

  return (
    <>
      <PageHeader
        title={t("importTitle")}
        description={t("importDescription")}
      />
      <ImportWorkbench />
    </>
  );
}
